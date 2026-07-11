* 2025
Notes to re-vive OpenDJ in 2025

# First task: get infinispan and nodejs back to work
It seems to fail, the connection/login does not work anymoe

## Run infinispan container:
podman run -e USER=username -e PASS="changeme" -p 11222:11222 quay.io/infinispan/server:14.0

## Try running the test cases on a RHEL9 system

Docs say we need NodeJS 14, but RHEL has only 18:

```
dnf module list nodejs
dnf module enable nodejs:18
dnf install nodejs

node app.js
```


This seems to work: infinispan/server:14.0
Put fails due to "default" cache not configured, thats fine.
--> works when cache "Default" is specificed in client, and configure manually using console


This does not work: infinispan/server:14.0
Fatal glibc error: CPU does not support x86-64-v3
--> seems to use UBI10

## Trying in RHEL9 VM with a totally fresh setup:

Trying with nodejs:22
dnf module enable nodejs:22
dnf install nodejs
dnf install npm

-> nodejs: 22.19.0, npm 10.9.3, infinispan 15.0.21--> works


Sample App:
```
var infinispan = require('infinispan');
var log4js = require('log4js');
log4js.configure('my-log4js.json');

var connected = infinispan.client(
  {port: 11222, host: '127.0.0.1'},
  {
    cacheName: 'Default',
    authentication: {
      enabled: true,
      saslMechanism: 'DIGEST-MD5',
      userName: 'username',
      password: 'changeme',
      serverName: 'infinispan'
    },
    dataFormat : {
      keyType: 'application/json',
      valueType: 'application/json'
    }
  }
);

connected.then(function (client) {

  var members = client.getTopologyInfo().getMembers();

  // Displays all members of the Infinispan cluster.
  console.log('Connected to: ' + JSON.stringify(members));

  var clientPut = client.put({k: 'key'}, {v: 'value'});

  var clientGet = clientPut.then(
      function() { return client.get({k: 'key'}); });

  var showGet = clientGet.then(
      function(value) { console.log("get({k: 'key'})=" + JSON.stringify(value)); });

  return showGet.finally(
      function() { return client.disconnect(); });



}).catch(function(error) {

  console.log("Got error: " + error.message);

});
```

my-log4js.json: 

{
  "appenders": {
    "test": {
      "type": "console"
    }
  },
  "categories": {
    "default": {
      "appenders": ["test"],
      "level": "trace"
    }
  }
}




##########
2025-11-23 --- Trying it on mak in tmpInfinispanTest

## run infinspan:
```
podman machine start
podman run -e USER=developer -e PASS=secret -p 11222:11222 quay.io/infinispan/server:15.2
```


--> node v24.10.0 with  Infinispan Server 15.2.6.Final on mac does NOT work (timeout )
The reason for that is that somehow, the client ist re-direccted to a 10.x IP adress on the podman network
That network is not reachable from the host, as on a mac, the container is running inside a VM
--> simple solution: run infinispan on the mac nativley using java, as before

## provider-spotify:
- switch datagrid login from "basic" to digest-md5
- switch data grid prod to create a cache to use digest by adding  sendImmediately:false
- getAudioFeaturesForTrack() in spotify api throws 403 forbidden - seems to be depreacted - simple commented it out

## service-playlist
- fix datagrid login, same as provider-spotify


## frontend-web
ionic and npm version mismatch
Need to install nvm (node version manager)
 brew install nvm 
 Node 16 seems to work:
 nvm install 16
--> not working, welcome to depdency hell
--> use claude to update depenced

to run, use:

nvm use 24
npm start


  # Build the image
  cd /Users/dfroehli/RedHat/projects/OpenDJ/components/frontend-web
  podman build -t opendj-frontend:latest -f Containerfile .

  # Run locally
  podman run -d -p 8080:80 --name opendj-frontend opendj-frontend:latest

  # Access at http://localhost:8080

  The nginx version is recommended for production use. Use the distroless version if you need maximum security and minimal attack surface.




 podman run -d \
    -p 8081:8081 \
    -e DATAGRID_URL=host.containers.internal:11222 \
    -e DATAGRID_USER=developer \
    -e DATAGRID_PSWD=--secret-- \
    -e LOG_LEVEL=info \
    quay.io/opendj/provider-spotify:master
    

# Run on MicroShift
need to prep USHIFT for IP V6, see:
https://docs.redhat.com/en/documentation/red_hat_build_of_microshift/4.17/html/configuring/microshift-nw-ipv6-config#microshift-nw-ipv6-dual-stack-migrating-config_microshift-nw-ipv6-config

# cat /etc/microshift/config.yaml
dns:
  baseDomain: opendj-dev
network:
  clusterNetwork:
  - 10.42.0.0/16 
  - fd01::/48  
  serviceNetwork:
  - 10.43.0.0/16
  - fd02::/112  
node:
  nodeIP: 192.168.0.116
  nodeIPv6: 2a02:8071:b585:8dc0::3b93

TODO: Why do I need to configre nodeIPv6? With ip v4, this works out of the box?
Thats really an issue when prefixes change???
Can I configure this more cleverly?

# DNS issue 
AAA does not resolve, issue with fritz box?
--> fritz box DNS rebind protection, need to add the domain names to fritz box config


# Next: cert-mgr resolver pod does not work with IPV6
 oc logs -f -n cert-manager Deployment/cert-manager
0110 10:50:56.979247       1 sync.go:208] "propagation check failed" err="failed to perform self check GET request 'http://dev.opendj.io/.well-known/acme-challenge/7TJyCRgNKIyoW2w_dW5Prm0z2MOHz1GZnkro1N19X5k': Get \"http://dev.opendj.io/.well-known/acme-challenge/7TJyCRgNKIyoW2w_dW5Prm0z2MOHz1GZnkro1N19X5k\": dial tcp [2001:16b8:a1a2:7f00:a00:27ff:feb0:d8bd]:80: connect: network is unreachable" logger="cert-manager.controller" resource_name="opendj-dev-1-2436226216-2147999548" resource_namespace="opendj-dev" resource_kind="Challenge" resource_version="v1" dnsName="dev.opendj.io" type="HTTP-01"

--> Bug in Fritzbox ? Works with Vodafone Network
--> fritz box DNS rebind protection, need to add the domain names to fritz box config


# AWS Route53

ionos Target Nameserver:
ns-540.awsdns-03.net, ns-1829.awsdns-36.co.uk, ns-82.awsdns-10.com, ns-1252.awsdns-28.org


# Does not work in Red Hat Office, because IPV6 server not supporet
Try / verify this is not working:
curl -6 -v www.google.de


Idea: setup nginx on AWS instance to forward IPV4 to IPV6 backend
https://github.com/orgs/opendj/projects/1?pane=issue&itemId=207198158&issue=opendj%7Copendj%7C368

## Spinup EC instance:
aws ec2 run-instances --image-id 'ami-07bdcf759aaa4c49d' --instance-type 't4g.nano' --key-name 'opendj-aws' --ebs-optimized --block-device-mappings '{"DeviceName":"/dev/xvda","Ebs":{"Encrypted":false,"DeleteOnTermination":true,"SnapshotId":"snap-07f164d4aad63d9f8","VolumeSize":8,"VolumeType":"standard"}}' --network-interfaces '{"SubnetId":"subnet-b753a1fb","AssociatePublicIpAddress":true,"DeviceIndex":0,"Ipv6AddressCount":1,"Groups":["sg-7a5a731d"]}' --credit-specification '{"CpuCredits":"unlimited"}' --tag-specifications '{"ResourceType":"instance","Tags":[{"Key":"Name","Value":"opendj-ip4-forwarder"}]}' --metadata-options '{"HttpEndpoint":"enabled","HttpPutResponseHopLimit":2,"HttpTokens":"required"}' --private-dns-name-options '{"HostnameType":"resource-name","EnableResourceNameDnsARecord":true,"EnableResourceNameDnsAAAARecord":true}' --count '1' 

## Login using public IP:
ssh -i "~/.ssh/opendj-aws.pem" ec2-user@ec2-3-69-29-206.eu-central-1.compute.amazonaws.com

sudo dnf install nginx -y

>>> that seems to be way more complicated then expected. Better idea:

## Move prod environment to IONOS VPS, thats not much more expensive compared to AWS, and we get full blown IPV4 and IP V6
We simply use all things upstream, i.e. alma linux, upstream microshift, infinispan etc.



## Deploy Cert Manager using helm:
helm install   cert-manager oci://quay.io/jetstack/charts/cert-manager   --version v1.20.3   --namespace cert-manager   --create-namespace   --set crds.enabled=true --set featureGates="ACMEHTTP01IngressPathTypeExact=false"


That does not work out of the box, because new cert-manager version uses Ingress with 
Starting in version 1.18, cert-manager changed the default pathType for its temporary HTTP-01 challenge Ingress objects from ImplementationSpecific to Exact.
However, OpenShift’s default route-controller-manager (which MicroShift runs internally to translate Ingress objects into native Routes) does not support the Exact path type. It explicitly rejects it, drops the translation rule, and throws the exact error you caught:
Incomplete ingress to route rules detected: Unsupported exact path type in rule at index 0, path index 0


To fix:
oc edit deployment cert-manager -n cert-manager

spec:
  containers:
  - name: cert-manager-controller
    args:
    - --v=2
    - --cluster-resource-namespace=$(POD_NAMESPACE)
    - --leader-election-namespace=kube-system
    - --feature-gates=ACMEHTTP01IngressPathTypeExact=false # Add this line
