# Helm Charts and Kubernetes dev environment

This directory contains config for deploying the Coalesce backend on Kubernetes using Helm. This is useful for production environments that can benefit from autoscaling the number of server processes.

## Setup

This will run a batteries-included Coalesce backend, including:

- PostgreSQL dev database
- Redis
- Minio object storage
- Ory Kratos authentication
- Coalesce API Server
- Coalesce Collab Server
- Coalesce Audio Processor (using CPU by default)

### Requirements

Install the following tools:
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)  
  `kind` runs a local Kubernetes cluster in Docker for testing or development.
- [kubectl](https://kubernetes.io/docs/tasks/tools/#kubectl)  
  `kubectl` is the standard tool for interacting with a Kubernetes cluster.
- [helm](https://helm.sh/docs/intro/install/)  
  `helm` packages up Kubernetes configuration into reusable packages ("charts").
- [helmfile](https://github.com/helmfile/helmfile/releases)  
  `helmfile` applies a set of helm charts based on declarative syntax.


### Build the container images

```sh
# Start in the top level directory of the repo.

# Build docker images for the backend services:
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.yml build api-server audio-processor

# Tag the docker images (give them a name and version so we can send to the kind cluster):
docker tag coalesce-project-server coalesce-project-server:0.0.1
docker tag coalesce-audio-processor coalesce-audio-processor:0.0.1
```

### Create the cluster

```sh
cd deploy/kubernetes

# First, create the kind cluster.
# kind-config.yaml exposes port 3333 on localhost for accessing the backend.
kind create cluster --config=./kind-config.yaml

# Send the docker images to the kind cluster:
kind load docker-image coalesce-project-server:0.0.1

# This image is very large and can take a while to load.
kind load docker-image coalesce-audio-processor:0.0.1

# Apply the Kubernetes configuration using Helm:
# We need to set up the envoy gateway release first because it sets up an `EnvoyProxy` resource. Helm will crash if the resource type doesn't exist first.
helmfile apply -l name=envoy-gateway

# Set up all of the services:
helmfile apply
```

The Coalesce backend should now be running on port 3333.

### Connect the frontend

To test or develop against the cluster, the frontend can be started using `docker-compose` for convenience (and live-reloading):

```sh
DOCKER_BUILDKIT=1 docker-compose --env-file docker-compose.env -f docker-compose.yml -f docker-compose.dev-k8s.yml up --build -d app
```

You should now find the Coalesce frontend running at: http://localhost:3000/home

### Speed up DNS cache

The [default Kubernetes CoreDNS config](https://kubernetes.io/docs/tasks/administer-cluster/dns-custom-nameservers/#coredns) has a 30 second cache and TTL for DNS entries. This slows down API servers discovering changes to the collab server ring.

Here's how to reduce the cache/TTL to 2 seconds:

```sh
kubectl apply -f coredns-cache.yaml
kubectl delete pod -n kube-system -l k8s-app=kube-dns
```

## Architecture

Coalesce's API server can be scaled and load balanced arbitrarily. It's fronted by a Kubernetes `ClusterIP` service.

The collab server is more complicated. All RPC and WebSocket connections to a particular project should run on a single instance of the collab server. This necessary for transcription output to be ordered consistently. It's also more efficient since the collab doc is only loaded once in memory, and updates don't need to be propagated between multiple servers.

The collab server is fronted by the API server, and shouldn't be accessible to the outside world. Discovery happens via a Kubernetes headless service. The API server queries available collab servers via DNS, and uses consistent hashing to direct .

It's okay for there to be a brief period of split-brain where clients are connected to an old instance while the cluster is scaling up or down. Collab document edits via the Y.js CRDT and RPC calls are idempotent. Data should not be corrupted, but users won't see each other's edits.

