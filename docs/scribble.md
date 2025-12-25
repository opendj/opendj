
## Install kafka on mac:
```bash
# Install:
brew install kafka

# Make sure jdk 1.8 is selected:
jenv local openjdk64-1.8.0.212


# Run single broker :
zookeeper-server-start /usr/local/etc/kafka/zookeeper.properties &
kafka-server-start /usr/local/etc/kafka/server.properties

# Run dual broker :
zookeeper-server-start /usr/local/etc/kafka/zookeeper.properties &
kafka-server-start /usr/local/etc/kafka/server0.properties
kafka-server-start /usr/local/etc/kafka/server1.properties


# Delete topics:
kafka-topics --bootstrap-server localhost:9092 --delete --topic opendj.state.provider-spotify
kafka-topics --bootstrap-server localhost:9092 --delete --topic opendj.data.playlist
kafka-topics --bootstrap-server localhost:9092 --delete --topic opendj.event.activity


# Create topics for dual brokers:
kafka-topics --bootstrap-server localhost:9092  --create --topic  opendj.state.provider-spotify --partitions 3 --replication-factor 2 --config retention.ms=43200000
kafka-topics --bootstrap-server localhost:9092  --create --topic opendj.data.event --partitions 3 --replication-factor 2 --config retention.ms=43200000
kafka-topics --bootstrap-server localhost:9092  --create --topic opendj.event.playlist --partitions 3 --replication-factor 2 --config retention.ms=43200000

kafka-topics --bootstrap-server localhost:9092  --create --topic opendj.event.activity --partitions 1 --replication-factor 1


# Delete Topics:
kafka-topics --bootstrap-server localhost:9092 --delete --topic opendj.state.provider-spotify
kafka-topics --bootstrap-server localhost:9092 --delete --topic opendj.data.event
kafka-topics --bootstrap-server localhost:9092 --delete --topic opendj.event.playlist

# Prod:
/opt/kafka/bin/kafka-topics.sh --zookeeper localhost:21810 --delete --topic opendj.event.activity


```

oc rsh backend-eventstore-zookeeper-0 /opt/kafka/bin/kafka-topics.sh --zookeeper localhost:21810 --delete --topic opendj.data.playlist

oc rsh backend-eventstore-zookeeper-0 /opt/kafka/bin/kafka-topics.sh --zookeeper localhost:21810 --create --topic opendj.data.playlist --partitions 1 --replication-factor 1 --config retention.ms=43200000




# Get Logs from latest deployment:
oc logs -f dc/spotify-provider-boundary

# GIT
## Reference issues in other repo:
sa-mw-dach/OpenDJ#53
sa-mw-dach/OpenDJ#64


# Spotify API

# provider api:
http://localhost:8081/api/provider-spotify/v1/events/demo/providers/spotify/login



http://localhost:8080/api/provider-spotify/v1/events/0/providers/spotify/login
http://localhost:8080/api/provider-spotify/v1/events/0/providers/spotify/currentTrack
http://localhost:8080/api/provider-spotify/v1/events/0/providers/spotify/devices
http://localhost:8080/api/provider-spotify/v1/events/0/providers/spotify/search?q=Michael+Jackson
http://localhost:8080/api/provider-spotify/v1/events/demo/providers/spotify/tracks/5ftamIDoDRpEvlZinDuNNW
http://localhost:8081/api/provider-spotify/v1/events/demo/providers/spotify/pause/
http://localhost:8080/api/provider-spotify/v1/events/0/providers/spotify/play/5ftamIDoDRpEvlZinDuNNW

http://localhost:8081/api/provider-spotify/v1/events/demo/providers/spotify/play/5ftamIDoDRpEvlZinDuNNW?pos=5000


http://localhost:8080/api/provider-spotify/v1/events/dan/providers/spotify/login
http://localhost:8080/api/provider-spotify/v1/events/dan/providers/spotify/devices
http://localhost:8080/api/provider-spotify/v1/events/dan/providers/spotify/play/5ftamIDoDRpEvlZinDuNNW

http://demo.opendj.io/api/provider-spotify/v1/events/dan/providers/spotify/login


http://dev.opendj.io/api/provider-spotify/v1/events/0/providers/spotify/login

http://dev.opendj.io/api/provider-spotify/v1/events/dan/providers/spotify/login
http://dev.opendj.io/api/provider-spotify/v1/events/dan/providers/spotify/tracks/5ftamIDoDRpEvlZinDuNNW

https://www.opendj.io/api/provider-spotify/v1/events/demo/providers/spotify/devices

#
curl -d '{ "currentDevice": "52e43fe15bf7fecf03e401ebe7af9519f0252d35"}' -H "Content-Type: application/json" -X POST  http://localhost:8081/api/provider-spotify/v1/events/demo/providers/spotify/devices

curl -d '{ "currentDevice": "25a633bd01646cabbd4a3df8ea239837e14bfb05"}' -H "Content-Type: application/json" -X POST  http://localhost:8081/api/provider-spotify/v1/events/demo/providers/spotify/devices


# Add Provider
curl -d '{ "type": "spotify", "display":"tst", "email":"a@b.c", "image_url":"none"}' -H "Content-Type: application/json" -X POST  http://localhost:8082/api/service-playlist/v1/events/demo/providers/




# Access Playlist
http://localhost:8082/api/service-playlist/v1/events/demo/
http://localhost:8081/api/service-playlist/v1/events/0/playlists/0


http://localhost:8081/api/service-playlist/v1/events/demo/playlists/0/play


http://dev.opendj.io/api/service-playlist/v1/events/demo/playlists/0

http://dev.opendj.io/api/service-playlist/v1/events/0/playlists/0/play
http://dev.opendj.io/api/service-playlist/v1/events/0/playlists/0/pause
http://dev.opendj.io/api/service-playlist/v1/events/0/playlists/0/next
http://dev.opendj.io/api/service-playlist/v1/events/0/playlists/0/push

http://demo.opendj.io/api/service-playlist/v1/events/0/playlists/0

https://www.opendj.io/api/service-playlist/v1/events/demo/



# Add Track
curl -d '{"provider":"spotify", "id":"3QTTAj8piyRBfhoPEfJC6y", "user": "HappyDan"}' -H "Content-Type: application/json" -X POST http://localhost:8081/api/service-playlist/v1/events/0/playlists/0/tracks

curl -d '{"provider":"spotify", "id":"3QTTAj8piyRBfhoPEfJC6y", "user": "HappyDan"}' -H "Content-Type: application/json" -X POST http://dev.opendj.io/api/service-playlist/v1/events/0/playlists/0/tracks

# Move Track:
curl -d '{"provider":"spotify", "id":"3Wz5JAW46aCFe1BwZIePu6", "from": "IDontCare", "to": "0"}' -H "Content-Type: application/json" -X POST http://dev.opendj.io:8081/api/service-playlist/v1/events/demo/playlists/0/reorder

# Delete Track
curl -X DELETE http://localhost:8081/api/service-playlist/v1/events/0/playlists/0/tracks/spotify:XXX3QTTAj8piyRBfhoPEfJC6y

curl -X DELETE http://dev.opendj.io/api/service-playlist/v1/events/0/playlists/0/tracks/spotify:3QTTAj8piyRBfhoPEfJC6y


# Provide Track Feedback:
curl -d '{"old":"", "new":"L"}' -H "Content-Type: application/json" -X POST  http://localhost:8082/api/service-playlist/v1/events/demo/playlists/demo/tracks/spotify%3A6u7jPi22kF8CTQ3rb9DHE7/feedback

# Login
curl -d '{"userState": {"username":"Daniel"}}' -H "Content-Type: application/json" -X POST  http://localhost:8083/api/service-web/v1/events/demo/user/login


# EventActivity
curl -d '{"old":"", "new":"L"}' -H "Content-Type: application/json" -X POST  http://localhost:8080/api/service-eventactivity/v1/events/demo/activity -v

# Cleanup:
oc adm prune builds --confirm
oc adm prune deployments --confirm
oc adm prune images --keep-tag-revisions=3 --keep-younger-than=60m --confirm --registry-url https://docker-registry-default.apps.ocp1.stormshift.coe.muc.redhat.com/  --force-insecure=true

# ETCD Health Check
[root@ocp1master2 ~]# etcdctl3 --endpoints="https://172.16.10.11:2379,https://172.16.10.12:2379,https://172.16.10.13:2379" endpoint health

https://docs.openshift.com/container-platform/3.11/day_two_guide/docker_tasks.html

# IONIC
sudo npm install -g ionic --save
ionic info
ionic generate page pages/event
ionic serve

# oc label from dev to tst:
oc project dfroehli-opendj-dev
oc tag provider-spotify:latest provider-spotify:tst
oc tag service-playlist:latest service-playlist:tst
oc tag service-web:latest service-web:tst
oc tag service-housekeeping:latest service-housekeeping:tst
oc tag frontend-web-artifact:latest frontend-web-artifact:tst
oc tag frontend-web:latest frontend-web:tst


NPM_MIRROR=https://repository.engineering.redhat.com/nexus/repository/registry.npmjs.org

# Git Project Labeling:
git tag -a 0.5.1 -m "Large Event - Event View Stats"
git push origin 0.5.1



 cd /opt/datagrid/standalone/configuration/user


 # Build and run event activity:
 ./mvnw compile quarkus:dev

 # Debug Quarkus:
 F1 Quarkus - Debug current Project

# Deploy Quarkus native:

# Native Build
oc new-build quay.io/quarkus/ubi-quarkus-native-s2i:19.2.1~https://github.com/opendj/opendj.git \
    --context-dir=components/service-eventactivity --name=service-eventactivity-native

# Minimum Image:
oc new-build --name=service-eventactivity-minimal \
    --docker-image=registry.access.redhat.com/ubi7-dev-preview/ubi-minimal \
    --source-image=service-eventactivity-native \
    --source-image-path='/home/quarkus/application:.' \
    --dockerfile=$'FROM registry.access.redhat.com/ubi7/ubi-minimal:latest\nCOPY application /application\nCMD /application\nEXPOSE 8080'

# Deploy that Image:
oc new-app service-eventactivity-minimal


# Tag Quay Image: (Credentials in  ~/.docker/config.json)

oc create serviceaccount skopeo
oc get secrets -o jsonpath='{range .items[?(@.metadata.annotations.kubernetes\.io/service-account\.name=="skopeo")]}{.metadata.annotations.openshift\.io/token-secret\.value}{end}' |tee skopeo-token
TOKEN="$(cat skopeo-token)"



# --- copy from ocp4 to quay latest ---
TOKEN=$(oc get secrets -o jsonpath='{range .items[?(@.metadata.annotations.kubernetes\.io/service-account\.name=="skopeo")]}{.metadata.annotations.openshift\.io/token-secret\.value}{end}')
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/provider-spotify:latest docker://quay.io/opendj/provider-spotify:latest
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-playlist:latest docker://quay.io/opendj/service-playlist:latest
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-housekeeping:latest docker://quay.io/opendj/service-housekeeping:latest
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-eventactivity-minimal:latest docker://quay.io/opendj/service-eventactivity:latest

skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-web:latest docker://quay.io/opendj/service-web:latest

skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/frontend-web:latest docker://quay.io/opendj/frontend-web:latest


# --- copy from ocp4 to quay uat ---
TOKEN=$(oc get secrets -o jsonpath='{range .items[?(@.metadata.annotations.kubernetes\.io/service-account\.name=="skopeo")]}{.metadata.annotations.openshift\.io/token-secret\.value}{end}' -n dfroehli-opendj-dev)
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/provider-spotify:latest docker://quay.io/opendj/provider-spotify:uat
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-playlist:latest docker://quay.io/opendj/service-playlist:uat

skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-housekeeping:latest docker://quay.io/opendj/service-housekeeping:uat
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-eventactivity-minimal:latest docker://quay.io/opendj/service-eventactivity:uat

skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-web:latest docker://quay.io/opendj/service-web:uat

skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp5.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/frontend-web:latest docker://quay.io/opendj/frontend-web:uat



# Label QUAY LATEST to PRD:
skopeo copy docker://quay.io/opendj/provider-spotify:latest docker://quay.io/opendj/provider-spotify:prd
skopeo copy docker://quay.io/opendj/service-playlist:latest docker://quay.io/opendj/service-playlist:prd
skopeo copy docker://quay.io/opendj/service-housekeeping:latest docker://quay.io/opendj/service-housekeeping:prd
skopeo copy docker://quay.io/opendj/service-eventactivity:latest docker://quay.io/opendj/service-eventactivity:prd
skopeo copy docker://quay.io/opendj/service-web:latest docker://quay.io/opendj/service-web:prd
skopeo copy docker://quay.io/opendj/frontend-web:latest docker://quay.io/opendj/frontend-web:prd

# Label QUAY uat to PRD:
skopeo copy docker://quay.io/opendj/provider-spotify:uat docker://quay.io/opendj/provider-spotify:prd
skopeo copy docker://quay.io/opendj/service-playlist:uat docker://quay.io/opendj/service-playlist:prd
skopeo copy docker://quay.io/opendj/service-housekeeping:uat docker://quay.io/opendj/service-housekeeping:prd
skopeo copy docker://quay.io/opendj/service-eventactivity:uat docker://quay.io/opendj/service-eventactivity:prd
skopeo copy docker://quay.io/opendj/service-web:uat docker://quay.io/opendj/service-web:prd
skopeo copy docker://quay.io/opendj/frontend-web:uat docker://quay.io/opendj/frontend-web:prd


# Import PRD TAG from Quay to OpenShift:
oc tag --source=docker quay.io/opendj/provider-spotify:prd provider-spotify:prd --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/service-playlist:prd service-playlist:prd --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/service-housekeeping:prd service-housekeeping:prd --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/service-eventactivity:prd service-eventactivity:prd --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/service-web:prd service-web:prd --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/frontend-web:prd frontend-web:prd --reference-policy=local --scheduled=true

# Import UAT TAG from Quay to OpenShift:
oc tag --source=docker quay.io/opendj/provider-spotify:uat provider-spotify:uat --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/service-playlist:uat service-playlist:uat --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/service-housekeeping:uat service-housekeeping:uat --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/service-eventactivity:uat service-eventactivity:uat --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/service-web:uat service-web:uat --reference-policy=local --scheduled=true
oc tag --source=docker quay.io/opendj/frontend-web:uat frontend-web:uat --reference-policy=local --scheduled=true


#
# Route53
#
aws --profile opendj-ops route53 list-hosted-zones
             "Id": "/hostedzone/Z2L93D4HGFH9GO",
            "Name": "opendj.io.",

aws --profile opendj-ops route53 list-resource-record-sets
    "ResourceRecordSets": [
        {
            "Name": "opendj.io.",
            "Type": "A",
            "TTL": 86400,
            "ResourceRecords": [
                {
                    "Value": "174.129.25.170"
                }
            ]
        },

aws --profile opendj-ops route53 change-resource-record-sets

