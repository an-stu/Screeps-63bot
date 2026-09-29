#!/usr/bin/env python3
"""Screeps 外矿健康检查（只读）。

一次跑完，输出固定的几项判据，便于每隔一段时间对比：
  1. 三个源的能量（长期停在 4000 = 没在采，外矿最核心的健康指标）
  2. carrier 数量（过量说明 pathTime 正反馈回路又失控）
  3. 道路 / 道路工地（工地掉到个位数说明 place 与 cleanup 互相打架）
  4. 两个 defenser 是否在各自认领的 lair 旁
  5. 矿物 H 与 stationMineral.container
  6. CPU 稳态与 bucket

用法：
  SCREEPS_TOKEN=xxx python3 scripts/monitor-outer.py
"""
import os
import sys

sys.path.insert(0, "/Users/an/.workbuddy/skills/screeps-console-probe/scripts")
from screeps_api import probe, mem, room_objects  # noqa: E402

TARGET = "W34N55"
HOME = "W33N55"

# 控制台只接受单条 return，且整串有 ~850~1050 字符上限；超了会**静默丢弃**。
# 所以拆成两个短探针，不要合并。
PROBE_A = (
    "return (function(){var a={};Object.keys(Game.creeps).forEach(function(n){var c=Game.creeps[n];"
    "var t=c.headTask&&c.headTask();if(!(t&&t.roomName=='%s'))return;"
    "a[c.memory.role]=(a[c.memory.role]||0)+1;});"
    # 真实存活 keeper 数：按 headTask.id（= 源 id）从 Game.creeps 全局统计。
    # 不要用 data["creeps"].length —— 那是登记字段，registerStationSources 有延迟，
    # 会在 keeper 明明已出生/在场时报 0，把「正常补员中」误判成「没有 keeper」。
    "var live={};Object.keys(Game.creeps).forEach(function(n){var c=Game.creeps[n];"
    "if(c.memory.role!='harvestEnergyKeeper')return;"
    "var t=c.headTask&&c.headTask();if(!t||!t.id)return;live[t.id]=(live[t.id]||0)+1;});"
    "var ss=Memory.rooms['%s'].stationSources;var pt={};"
    "for(var k in ss){var d=ss[k];pt[d.x+','+d.y]=[d.pathTime||0,live[d.id]||0,d.container?1:0];}"
    "var mm=Memory.rooms['%s'].stationMineral;var rr=Game.rooms['%s'];"
    # roadSites 一定要在游戏内数：REST /api/game/room-objects 会**少报工地**
    # （实测真实 33 个它只给 2 个），拿它做判据会误报「工地偏少」。
    "return {t:Game.time,roles:a,pathTime:pt,mineralContainer:mm.container?1:0,"
    "roadSites:rr?rr.find(FIND_MY_CONSTRUCTION_SITES).filter(function(e){return e.structureType=='road';}).length:0};})();"
) % (TARGET, TARGET, TARGET, TARGET)

PROBE_B = (
    "return (function(){var r=Game.rooms['%s'];if(!r)return 'novision';var d=[];"
    "Object.keys(Game.creeps).forEach(function(n){var c=Game.creeps[n];"
    "if(c.memory.role!='outerHarvestDefenser')return;var t=c.headTask&&c.headTask();"
    "if(!(t&&t.roomName=='%s'))return;var ps=StationSources.outerDefensePosts(c);"
    "var w=null;ps.forEach(function(e){if(e.ticksToSpawn!==undefined&&(!w||e.ticksToSpawn<w.ticksToSpawn))w=e;});"
    "d.push([c.pos.x,c.pos.y,c.memory.defenseGroup,c.ticksToLive,"
    "w?w.pos.x+','+w.pos.y+' d='+c.pos.getRangeTo(w.pos):'-',c.memory.hasSendSpawn?1:0]);});"
    "return {lairs:r.find(FIND_HOSTILE_STRUCTURES).filter(function(e){return e.structureType=='keeperLair';})"
    ".map(function(e){return e.pos.x+','+e.pos.y+':'+e.ticksToSpawn;}),"
    "defs:d,hostiles:r.find(FIND_HOSTILE_CREEPS).length,"
    "lead:StationSources.outerDefenseReplaceLead('%s',Game.rooms['%s'])};})();"
) % (TARGET, TARGET, TARGET, HOME)


def main():
    if not os.environ.get("SCREEPS_TOKEN"):
        print("!! 需要环境变量 SCREEPS_TOKEN")
        return 1

    ch = mem("codeHealth") or {}
    print("== 账号 ==")
    print("  cpu=%.2f averageCpu=%.2f bucket=%s creeps=%s missingTaskHandlers=%s"
          % (ch.get("cpu", 0), ch.get("averageCpu", 0), ch.get("bucket"),
             ch.get("creeps"), ch.get("missingTaskHandlers")))

    buckets = mem("cpuTelemetry.buckets") or []
    print("  最近 5 桶:")
    for b in buckets[-5:]:
        n = max(1, b.get("samples", 1))
        print("    %s avg=%-6.2f max=%-6.1f overLimit=%s/%s"
              % (b.get("id"), b.get("sum", 0) / n, b.get("max", 0), b.get("overLimit"), n))

    objs = room_objects(TARGET)
    roads = sum(1 for o in objs if o.get("type") == "road")
    sites = [o for o in objs if o.get("type") == "constructionSite"]
    # REST 的工地列表不完整，道路工地以游戏内探针为准（见 PROBE_A）
    rest_road_sites = sum(1 for o in sites if o.get("structureType") == "road")
    src = [(o["x"], o["y"], o.get("energy")) for o in objs if o.get("type") == "source"]
    ctr = [(o["x"], o["y"], round(o.get("store", {}).get("energy", 0)),
            round(o.get("store", {}).get("H", 0))) for o in objs if o.get("type") == "container"]
    mn = [(o.get("mineralType"), o.get("mineralAmount")) for o in objs if o.get("type") == "mineral"]
    tombs = [(o["x"], o["y"], o.get("deathTime")) for o in objs if o.get("type") == "tombstone"]

    print("== %s ==" % TARGET)
    print("  roads=%d  containers=%s" % (roads, ctr))
    print("  sources=%s      <- 长期 4000 就是没在采" % (src,))
    print("  mineral=%s" % (mn,))
    print("  tombstones(最近 8)=%s" % (sorted(tombs, key=lambda x: -(x[2] or 0))[:8],))

    p = probe(PROBE_A)
    if not isinstance(p, dict):
        print("  !! 探针失败: %r" % (p,))
        return 1
    print("  roles=%s" % (p.get("roles"),))
    print("  pathTime/liveKeeper/container=%s   <- liveKeeper 是真实存活数" % (p.get("pathTime"),))
    dead = [k for k, v in (p.get("pathTime") or {}).items() if v[1] == 0]
    if dead:
        print("     !! 无 keeper 的矿点: %s" % dead)
    print("  mineralContainer=%s" % (p.get("mineralContainer"),))

    q = probe(PROBE_B)
    if isinstance(q, dict):
        print("  lairs=%s" % (q.get("lairs"),))
        # 防守爬：[x, y, group, ttl, 目标窝/距离, 是否已派过接替]
        # ttl 低于提前量 lead 就该派接替了；这一栏专门用来提前发现「防守断档」——
        # 老那只快死了、接替却还没到位，keeper 就会去打我们的矿工。
        lead = q.get("lead")
        print("  defenders(ttl / 提前量=%s)=%s" % (lead, q.get("defs"),))
        for d in (q.get("defs") or []):
            ttl = d[3] if len(d) > 3 else None
            if isinstance(ttl, int) and isinstance(lead, int) and 0 < ttl <= lead:
                print("     !! 防守爬 ttl=%s <= 提前量 %s（sendSpawn=%s）：确认接替是否已到位"
                      % (ttl, lead, d[5] if len(d) > 5 else "?"))
        print("  hostiles=%s" % (q.get("hostiles"),))
    else:
        print("  !! 第二段探针失败: %r" % (q,))

    print("== 判据 ==")
    n_carrier = (p.get("roles") or {}).get("outerHarvestEnergyCarrier", 0)
    full = [s for s in src if s[2] == 4000]
    print("  carrier=%d %s" % (n_carrier, "OK" if n_carrier <= 6 else "!! 过量，pathTime 回路可能又失控"))
    print("  满仓源=%d/3 %s" % (len(full), "OK" if not full else "!! 有源没在采"))
    rs = p.get("roadSites", 0)
    print("  道路工地=%d %s  (REST 同项=%d；以游戏内计数为准，REST 曾把 33 报成 2)" % (rs, "OK" if rs >= 10 or roads >= 90 else "!! 偏少，查 place/cleanup 是否打架", rest_road_sites))
    if mn and mn[0][1] is not None:
        print("  矿物 %s=%s %s" % (mn[0][0], mn[0][1], "OK(已开始采)" if mn[0][1] < 35000 else "尚未开采"))
    b = ch.get("bucket") or 0
    print("  bucket=%s %s" % (b, "OK" if b > 6000 else "!! 偏低"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
