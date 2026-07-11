#!/bin/bash
set -euo pipefail 
API_KEY=$(cat .abuseipdb.key)
LIMIT=10000 
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

echo "---------------------------"
date --iso-8601=seconds 
echo "---------------------------"
echo "### IP V4 ###"
echo "1. Fetch plaintext list from AbuseIPDB"
IP_LIST=$(curl -sG https://api.abuseipdb.com/api/v2/blacklist \
  -d key=$API_KEY \
  -d limit=$LIMIT \
  -d ipVersion=4 \
  -d plaintext)

if [ -n "$IP_LIST" ]; then
    echo 2. Format the downloaded IPs so the system can read them line by line
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
    cp /tmp/abuse_ips.txt /root/abuse_ips_applied.txt
fi

#
# Now the same for IP V6:
#
echo "### IP V6 ###"
echo "1. Fetch plaintext IPv6 list from AbuseIPDB"
IP_LIST=$(curl -sG https://api.abuseipdb.com/api/v2/blacklist \
  -d key=$API_KEY \
  -d limit=$LIMIT \
  -d ipVersion=6 \
  -d plaintext)

if [ -n "$IP_LIST" ]; then
    echo "2. Format the downloaded IPs so the system can read them line by line"
    echo "$IP_LIST" > /tmp/abuse_ips_v6.txt
    cp /tmp/abuse_ips_v6.txt /tmp/abuse_ips_v6.bak   

    echo "3. Ensure the live IPv6 set exists (first run)"
    # Added 'family inet6' to support IPv6 addresses
    ipset create abuseipdb_v6 hash:net family inet6 -exist

    echo "4. Ensure ip6tables rule exists to drop traffic from the set (first run)"
    # Switched 'iptables' to 'ip6tables' for IPv6 traffic processing
    ip6tables -C INPUT -m set --match-set abuseipdb_v6 src -j DROP 2>/dev/null \
      || ip6tables -I INPUT -m set --match-set abuseipdb_v6 src -j DROP

    echo "5. Create a temporary 'swap' set so your firewall never drops its guard"
    ipset destroy abuseipdb_v6_temp -exist
    ipset create abuseipdb_v6_temp hash:net family inet6 -exist

    echo "6. Populate the temporary set line by line"
    while read -r ip; do
        # Ignore empty lines or comments if any exist (removed the ':' check so it allows IPv6)
        [[ -z "$ip" || "$ip" =~ ^# ]] && continue
        ipset add abuseipdb_v6_temp "$ip"
    done < /tmp/abuse_ips_v6.bak

    echo "7. Atomic swap: replace the live set with the new data"
    ipset swap abuseipdb_v6_temp abuseipdb_v6

    echo "8. Clean up the temporary set and files"
    ipset destroy abuseipdb_v6_temp
    cp /tmp/abuse_ips_v6.txt /root/abuse_ips_v6_applied.txt
fi
