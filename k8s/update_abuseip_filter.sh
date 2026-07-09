#!/bin/bash
set -euox pipefail 
API_KEY=$ABUSEIP_API_KEY
LIMIT=10000 

# 1. Fetch plaintext list from AbuseIPDB
IP_LIST=$(curl -sG https://api.abuseipdb.com/api/v2/blacklist \
  -d key=$API_KEY \
  -d limit=$LIMIT \
  -d plaintext)

if [ -n "$IP_LIST" ]; then
    # 2. Format the downloaded IPs so the system can read them line by line
    echo "$IP_LIST" > /tmp/abuse_ips.txt

    # 3. Ensure the live set exists (first run)
    sudo ipset create abuseipdb hash:net -exist

    # 4. Ensure iptables rule exists to drop traffic from the set (first run)
    sudo iptables -C INPUT -m set --match-set abuseipdb src -j DROP 2>/dev/null \
      || sudo iptables -I INPUT -m set --match-set abuseipdb src -j DROP

    # 5. Create a temporary 'swap' set so your firewall never drops its guard
    sudo ipset create abuseipdb_temp hash:net

    # 6. Populate the temporary set line by line
    while read -r ip; do
        # Ignore empty lines or comments if any exist
        [[ -z "$ip" || "$ip" =~ ^# ]] && continue
        sudo ipset add abuseipdb_temp "$ip"
    done < /tmp/abuse_ips.txt

    # 7. Atomic swap: replace the live set with the new data
    sudo ipset swap abuseipdb_temp abuseipdb

    # 8. Clean up the temporary set and files
    sudo ipset destroy abuseipdb_temp
    rm /tmp/abuse_ips.txt
fi