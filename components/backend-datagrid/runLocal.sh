#/Users/dfroehli/RedHat/Demos/datagrid/infinispan-server-9.4.15.Final/bin/standalone.sh -c clustered.xm
/Users/dfroehli/RedHat/Demos/datagrid/redhat-datagrid-8.0.0-server/bin/server.sh


# 2025-12:
/Users/dfroehli/RedHat/Demos/datagrid/infinispan-server-15.2.6.Final/bin/server.sh




# In a container
# Attention:  this does not work on a mac with podman machine, where the container is running inside a VM, and the client tries
# to connect on some 10.x podman network

podman run -e USER=developer -e PASS="--secret---" -p 11222:11222 quay.io/infinispan/server:14.0

