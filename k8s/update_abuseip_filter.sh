#!/bin/bash
set -euo pipefail 
API_KEY=$ABUSEIP_API_KEY
LIMIT=10000 

echo "1. Fetch plaintext list from AbuseIPDB"
IP_LIST=$(curl -sG https://api.abuseipdb.com/api/v2/blacklist \
  -d key=$API_KEY \
  -d limit=$LIMIT \
  -d plaintext)

if [ -n "$IP_LIST" ]; then
    echo "2. Format the downloaded IPs so the system can read them line by line"
    echo "$IP_LIST" > /tmp/abuse_ips.txt
    cp /tmp/abuse_ips.txt /tmp/abuse_ips.bak   

    echo "3. Ensure the live set exists (first run)"
    ipset create abuseipdb hash:net -exist

    echo "4. Ensure iptables rule exists to drop traffic from the set (first run)"
    iptables -C INPUT -m set --match-set abuseipdb src -j DROP 2>/dev/null \
      || iptables -I INPUT -m set --match-set abuseipdb src -j DROP

    echo "5. Create a temporary 'swap' set so your firewall never drops its guard"
    ipset destroy abuseipdb_temp -exist
    ipset create abuseipdb_temp hash:net -exist

    echo "6. Populate the temporary set line by line"
    while read -r ip; do
        # Ignore empty lines, or  IPV6 or comments if any exist
        [[ -z "$ip" || "$ip" =~ ^# || "$ip" =~ : ]] && continue
        ipset add abuseipdb_temp "$ip"
    done < /tmp/abuse_ips.bak

    echo "7. Atomic swap: replace the live set with the new data"
    ipset swap abuseipdb_temp abuseipdb

    echo "8. Clean up the temporary set and files"
    ipset destroy abuseipdb_temp
    mv /tmp/abuse_ips.txt /root/abuse_ips_applied.txt
fi
