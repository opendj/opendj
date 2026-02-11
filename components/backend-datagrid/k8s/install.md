
# Docs
https://infinispan.org/docs/helm-chart/main/helm-chart.html#installing-chart-command-line_install


https://github.com/infinispan/infinispan-helm-charts/blob/main/README.md


# Install Helm:
curl -L https://mirror.openshift.com/pub/openshift-v4/clients/helm/latest/helm-linux-amd64 -o /usr/local/bin/helm
chmod +x /usr/local/bin/helm

# Install helm repo openshift (contains infinispan)
helm repo add openshift-helm-charts https://charts.openshift.io/
helm repo update


# Deploy chart: 
helm install infinispan openshift-helm-charts/infinispan --values infinispan-values.yaml
helm install infinispan openshift-helm-charts/infinispan --values infinispan-values.yaml --namespace infinispan --create-namespace


# To upgrade (e.g. when values changed)
helm upgrade infinispan openshift-helm-charts/infinispan --values infinispan-values.yaml --namespace infinispan --create-namespace

# Uninstall:
helm uninstall backend-datagrid       
