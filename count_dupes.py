import redis
import json
import time

r = redis.Redis.from_url('redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341')

try:
    history_raw = r.get('bulks:history')
    if not history_raw:
        print("No history found")
    cands_raw = r.zrange('candidates_list', 0, -1)
    print(f"Total candidates in Database: {len(cands_raw)}")
    
    candidates = []
    for c in cands_raw:
        try:
            c_json = json.loads(c)
            candidates.append(c_json.get('id', ''))
        except:
            pass
            
    print(f"Scanning messages for {len(candidates)} candidates...")
    triplicated = 0
    duplicated = 0
    clean = 0
    
    for cid in candidates:
        if not cid: continue
        raw_msgs = r.lrange(f"messages:{cid}", 0, -1)
        msgs = [json.loads(m) for m in raw_msgs]
        
        # Count messages by content in the last 2 hours
        now = time.time() * 1000
        # some timestamps are strings, some are numbers in ms, some are in seconds
        recent = []
        for m in msgs:
            if m.get('from') != 'me': continue
            ts = m.get('timestamp')
            if not ts: continue
            
            ts_num = float(ts)
            if ts_num < 1e11:
                ts_num *= 1000
            
            if (now - ts_num) < 2*3600*1000:
                recent.append(m)
        
        counts = {}
        for m in recent:
            c = m.get('content', '')
            counts[c] = counts.get(c, 0) + 1
            
        max_dupes = max(counts.values()) if counts else 0
        if max_dupes >= 3:
            triplicated += 1
        elif max_dupes == 2:
            duplicated += 1
        else:
            clean += 1
            
    print(f"Total Triplicated: {triplicated}")
    print(f"Total Duplicated: {duplicated}")
    print(f"1x (Clean): {clean}")
except Exception as e:
    print(e)
