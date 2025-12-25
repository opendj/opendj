# Container Build and Deployment Guide

This directory contains everything needed to build and deploy the OpenDJ frontend-web component as a container.

## Files Overview

- **Containerfile**: Multi-stage build using Red Hat UBI Node.js and nginx-unprivileged (recommended for production)
- **Containerfile.distroless**: Alternative using Red Hat UBI Node.js and Google distroless image
- **nginx.conf**: Nginx configuration optimized for Angular SPA running unprivileged on port 8080
- **.dockerignore**: Files to exclude from the container build
- **kubernetes-deployment.yaml**: Sample Kubernetes deployment manifest

## Base Images Used

All base images are from registries without rate limits:

- **Builder stage**: `registry.access.redhat.com/ubi9/nodejs-20` - Red Hat Universal Base Image with Node.js 20 LTS
- **Runtime stage**: `quay.io/nginx/nginx-unprivileged:alpine` - Official nginx unprivileged image from Quay.io
- **Distroless**: `gcr.io/distroless/nodejs20-debian12:nonroot` - Google's distroless Node.js 20 image

These images avoid Docker Hub rate limits and are production-ready.

### Why Node.js 20?

- **LTS Support**: Node.js 20 is the current Long-Term Support version (active until April 2026)
- **Angular 18 Compatible**: Fully supported by Angular 18
- **Modern Features**: Includes latest security updates and performance improvements
- **Production Ready**: Recommended for enterprise deployments

## Building the Container Image

### Option 1: Using Podman (Recommended)

```bash
# Build with nginx (recommended)
podman build -t opendj-frontend:latest -f Containerfile .

# Or build with distroless
podman build -t opendj-frontend:distroless -f Containerfile.distroless .
```

### Option 2: Using Docker

```bash
# Build with nginx (recommended)
docker build -t opendj-frontend:latest -f Containerfile .

# Or build with distroless
docker build -t opendj-frontend:distroless -f Containerfile.distroless .
```

### Option 3: Using Buildah

```bash
buildah bud -t opendj-frontend:latest -f Containerfile .
```

## Running Locally

### With Podman

```bash
# Run the container
podman run -d -p 8080:8080 --name opendj-frontend opendj-frontend:latest

# View logs
podman logs -f opendj-frontend

# Stop the container
podman stop opendj-frontend

# Remove the container
podman rm opendj-frontend
```

### With Docker

```bash
docker run -d -p 8080:8080 --name opendj-frontend opendj-frontend:latest
```

Then access the application at http://localhost:8080

## Pushing to a Registry

### Push to Docker Hub

```bash
# Tag the image
podman tag opendj-frontend:latest yourusername/opendj-frontend:latest

# Login
podman login docker.io

# Push
podman push yourusername/opendj-frontend:latest
```

### Push to Red Hat Quay.io

```bash
# Tag the image
podman tag opendj-frontend:latest quay.io/yourusername/opendj-frontend:latest

# Login
podman login quay.io

# Push
podman push quay.io/yourusername/opendj-frontend:latest
```

### Push to GitHub Container Registry

```bash
# Tag the image
podman tag opendj-frontend:latest ghcr.io/yourusername/opendj-frontend:latest

# Login (use a GitHub personal access token)
echo $GITHUB_TOKEN | podman login ghcr.io -u yourusername --password-stdin

# Push
podman push ghcr.io/yourusername/opendj-frontend:latest
```

## Deploying to Kubernetes

### Prerequisites

- Kubernetes cluster (minikube, kind, OpenShift, or cloud provider)
- kubectl or oc CLI configured
- Container image pushed to a registry

### Update the Image Reference

Edit `kubernetes-deployment.yaml` and update the image reference:

```yaml
spec:
  containers:
  - name: frontend
    image: quay.io/yourusername/opendj-frontend:latest  # Update this
```

### Deploy

```bash
# Apply the manifest
kubectl apply -f kubernetes-deployment.yaml

# Check deployment status
kubectl get pods -n opendj
kubectl get svc -n opendj
kubectl get ingress -n opendj

# View logs
kubectl logs -n opendj -l app=opendj-frontend -f
```

### Update Ingress Host

Edit the ingress section in `kubernetes-deployment.yaml`:

```yaml
spec:
  rules:
  - host: opendj.yourdomain.com  # Update this
```

### Accessing the Application

If using port-forward:
```bash
kubectl port-forward -n opendj svc/opendj-frontend 8080:80
```

Then access at http://localhost:8080

## Deploying to OpenShift

OpenShift users can use the same Kubernetes manifests, but you might want to create a Route instead of Ingress:

```yaml
---
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: opendj-frontend
  namespace: opendj
spec:
  to:
    kind: Service
    name: opendj-frontend
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

Apply with:
```bash
oc apply -f openshift-route.yaml
```

## Image Comparison

### nginx:alpine (Containerfile)
- **Size**: ~25-30 MB
- **Pros**: Battle-tested, excellent performance, widely used
- **Cons**: Slightly larger than distroless
- **Security**: Regular Alpine Linux base with security updates

### Distroless (Containerfile.distroless)
- **Size**: ~120 MB (due to Node.js runtime)
- **Pros**: Minimal attack surface, no shell, no package manager
- **Cons**: Harder to debug, requires serve package
- **Security**: Google's distroless base, nonroot user by default

## Configuration

### Environment Variables

If you need to pass configuration to the Angular app, you can mount a ConfigMap:

```yaml
# Create ConfigMap
kubectl create configmap opendj-config \
  --from-file=config.json \
  -n opendj

# Mount in deployment
volumeMounts:
- name: config
  mountPath: /usr/share/nginx/html/conf
volumes:
- name: config
  configMap:
    name: opendj-config
```

## Health Checks

The nginx configuration includes a `/health` endpoint:

```bash
# Test health check
curl http://localhost:8080/health
```

## Troubleshooting

### Build fails with "npm ci" errors
Make sure you're using the `--legacy-peer-deps` flag (already included in Containerfile)

### Container won't start
Check logs:
```bash
podman logs opendj-frontend
kubectl logs -n opendj -l app=opendj-frontend
```

### 404 errors on refresh
The nginx.conf includes SPA routing. Make sure it's copied correctly.

### Permission issues with distroless
The distroless image runs as nonroot user (UID 65532) by default. Ensure your Kubernetes SecurityContext allows this.

## Security Best Practices

1. **Don't run as root**: Both images are configured to run as non-root users
2. **Use specific tags**: Don't use `latest` in production, use version tags
3. **Scan images**: Use `podman scan` or `trivy` to scan for vulnerabilities
4. **Keep updated**: Regularly rebuild images to get security updates
5. **Use secrets**: Store sensitive config in Kubernetes Secrets, not ConfigMaps

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Push Container

on:
  push:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3

    - name: Build Image
      run: |
        cd components/frontend-web
        podman build -t ghcr.io/${{ github.repository }}/frontend:${{ github.sha }} .

    - name: Push to GHCR
      run: |
        echo ${{ secrets.GITHUB_TOKEN }} | podman login ghcr.io -u ${{ github.actor }} --password-stdin
        podman push ghcr.io/${{ github.repository }}/frontend:${{ github.sha }}
```

## Additional Resources

- [Angular Deployment Guide](https://angular.io/guide/deployment)
- [Nginx Docker Documentation](https://hub.docker.com/_/nginx)
- [Google Distroless Images](https://github.com/GoogleContainerTools/distroless)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
