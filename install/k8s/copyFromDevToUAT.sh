TOKEN=$(oc get secrets -o jsonpath='{range .items[?(@.metadata.annotations.kubernetes\.io/service-account\.name=="skopeo")]}{.metadata.annotations.openshift\.io/token-secret\.value}{end}' -n dfroehli-opendj-dev)
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp4.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/provider-spotify:latest docker://quay.io/opendj/provider-spotify:uat
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp4.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-playlist:latest docker://quay.io/opendj/service-playlist:uat

skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp4.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-housekeeping:latest docker://quay.io/opendj/service-housekeeping:uat
skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp4.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-eventactivity-minimal:latest docker://quay.io/opendj/service-eventactivity:uat

skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp4.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/service-web:latest docker://quay.io/opendj/service-web:uat

skopeo copy --src-tls-verify=false --src-creds skopeo:$TOKEN docker://default-route-openshift-image-registry.apps.ocp4.stormshift.coe.muc.redhat.com/dfroehli-opendj-dev/frontend-web:latest docker://quay.io/opendj/frontend-web:uat
