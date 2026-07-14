#
# Trigger a fresh rollout
#
oc rollout restart Deployment/provider-spotify 
oc rollout restart Deployment/service-playlist
oc rollout restart Deployment/service-web
oc rollout restart Deployment/frontend-web
oc rollout restart Deployment/service-eventactivity
oc rollout restart Deployment/service-housekeeping
