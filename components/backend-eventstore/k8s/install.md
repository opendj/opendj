
# Install the operator to watch all namespace as documented here:
https://docs.redhat.com/en/documentation/red_hat_streams_for_apache_kafka/3.1/html/deploying_and_managing_streams_for_apache_kafka_on_openshift/deploy-tasks_str#deploying-cluster-operator-to-watch-whole-cluster-str

We install into namespace kafka-operator:



# Step 0: create the namespace ( Missing in the docs)
oc create namespace kafka-operator

# Step 1; Use the namespace: 
sed -i '' 's/namespace: .*/namespace: kafka-operator/' install/cluster-operator/*RoleBinding*.yaml

# Step 2:
# set the value of the STRIMZI_NAMESPACE environment variable to *.
# - name: STRIMZI_NAMESPACE
#           value: "*"

 vi install/cluster-operator/060-Deployment-strimzi-cluster-operator.yaml


# Step 3: ClusterRoleBindings
 oc create clusterrolebinding strimzi-cluster-operator-namespaced --clusterrole=strimzi-cluster-operator-namespaced --serviceaccount kafka-operator:strimzi-cluster-operator
oc create clusterrolebinding strimzi-cluster-operator-watched --clusterrole=strimzi-cluster-operator-watched --serviceaccount kafka-operator:strimzi-cluster-operator
oc create clusterrolebinding strimzi-cluster-operator-entity-operator-delegation --clusterrole=strimzi-entity-operator --serviceaccount kafka-operator:strimzi-cluster-operator

# Step 4: Deploy:
oc apply -f install/cluster-operator -n kafka-operator