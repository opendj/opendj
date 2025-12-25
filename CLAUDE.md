# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenDJ is a collaborative music playlist application for events that applies open-source principles to the dance floor. Participants can contribute tracks, vote on them, and curators manage the playlist. The system integrates with music streaming providers (primarily Spotify) to control playback.

## Architecture

OpenDJ uses a microservices architecture with the following key components:

### Backend Services (Node.js/Express)

- **provider-spotify** (port 8081): Integrates with Spotify Web API for track search, playback control, and device management. Caches track metadata and authentication state in Infinispan.

- **service-playlist** (port 8082): Core playlist management service. Handles track additions, ordering, voting (like/dislike), provider registration, and playlist state. Communicates with provider-spotify for track operations and publishes activity events.

- **service-web** (port 3000): WebSocket server using Socket.IO for real-time client communication. Consumes Kafka events from service-eventactivity and broadcasts updates to connected clients. Maintains user/curator stats and activity history in memory.

- **service-housekeeping**: Periodic cleanup tasks for Infinispan caches using node-cron.

- **service-eventactivity** (Java/Quarkus): Event sourcing service that receives activity events via REST API and publishes them to Kafka topics. Uses Infinispan for state persistence.

- **service-track-advisor-ml**: Machine learning service for track recommendations.

### Data Layer

- **backend-datagrid**: Red Hat Data Grid (Infinispan) server for distributed caching and persistence. Stores:
  - Track metadata (cache: tracks)
  - Provider authentication state (cache: state)
  - Event configurations
  - Playlist data

- **backend-eventstore**: Kafka/Zookeeper cluster for event streaming. Key topics:
  - `opendj.event.activity`: Activity events (user actions, track changes)
  - `opendj.data.playlist`: Playlist state changes
  - `opendj.state.provider-spotify`: Spotify provider state

### Frontend

- **frontend-web**: Ionic/Angular 7 application providing user and curator interfaces. Uses Socket.IO for real-time updates and REST APIs for CRUD operations.

## Component Communication

1. Frontend connects to service-web via WebSocket for real-time updates
2. Frontend makes REST calls to service-playlist for playlist operations
3. service-playlist calls provider-spotify for Spotify operations
4. All services publish activity events to service-eventactivity
5. service-eventactivity publishes to Kafka
6. service-web consumes Kafka events and broadcasts via WebSocket to connected clients
7. All Node.js services use Infinispan for distributed caching/state

## Common Development Commands

### Running Services Locally

Start Infinispan (required for most services):
```bash
# Using local installation
/Users/dfroehli/RedHat/Demos/datagrid/infinispan-server-15.2.6.Final/bin/server.sh

# Or using container (note: may have networking issues on Mac with podman machine)
podman run -e USER=developer -e PASS="--secret--" -p 11222:11222 quay.io/infinispan/server:14.0
```

Start Kafka (required for service-web and service-eventactivity):
```bash
# Single broker
zookeeper-server-start /usr/local/etc/kafka/zookeeper.properties &
kafka-server-start /usr/local/etc/kafka/server.properties

# Create topics (dual broker setup)
kafka-topics --bootstrap-server localhost:9092 --create --topic opendj.state.provider-spotify --partitions 3 --replication-factor 2 --config retention.ms=43200000
kafka-topics --bootstrap-server localhost:9092 --create --topic opendj.data.event --partitions 3 --replication-factor 2 --config retention.ms=43200000
kafka-topics --bootstrap-server localhost:9092 --create --topic opendj.event.playlist --partitions 3 --replication-factor 2 --config retention.ms=43200000
kafka-topics --bootstrap-server localhost:9092 --create --topic opendj.event.activity --partitions 1 --replication-factor 1
```

Start individual Node.js services:
```bash
# provider-spotify
cd components/provider-spotify
npm start

# service-playlist
cd components/service-playlist
npm start

# service-web
cd components/service-web
npm start

# service-housekeeping
cd components/service-housekeeping
npm start
```

Start Java service (Quarkus):
```bash
cd components/service-eventactivity
./mvnw compile quarkus:dev
```

Start frontend:
```bash
cd components/frontend-web
npm start  # or: ionic serve
```

### Building

Frontend build (production):
```bash
cd components/frontend-web
npm run build  # runs: ng build --prod
```

### Testing

Node.js services:
```bash
npm test  # runs mocha or tape depending on component
```

Frontend:
```bash
cd components/frontend-web
npm test     # runs: ng test (Karma/Jasmine)
npm run e2e  # runs: ng e2e (Protractor)
```

### Linting

```bash
npm run lint  # Most components use jshint or xo
```

Frontend (Angular):
```bash
cd components/frontend-web
npm run lint  # runs: ng lint
```

## Environment Variables

### Common across services:
- `PORT`: Service port (default varies by component)
- `LOG_LEVEL`: Logging level (default: "trace")
- `COMPRESS_RESULT`: Enable compression (default: "true")

### Infinispan connection:
- `DATAGRID_URL`: Infinispan server (default: "localhost:11222")
- `DATAGRID_USER`: Username (default: "developer")
- `DATAGRID_PSWD`: Password (default: "--secret--")

### Kafka connection (service-web):
- `KAFKA_HOST`: Kafka broker (default: "localhost:9092")
- `KAFKA_TOPIC_ACTIVITY`: Activity topic (default: "opendj.event.activity")

### Service URLs:
- `PLAYLIST_PROVIDER_URL`: service-playlist endpoint
- `SPOTIFY_PROVIDER_URL`: provider-spotify endpoint
- `EVENTACTIVITY_PROVIDER_URL`: service-eventactivity endpoint
- `TRACKAI_PROVIDER_URL`: ML service endpoint

### Demo/Test mode (service-playlist):
- `TEST_EVENT_CREATE`: Auto-create demo event (default: "true")
- `TEST_EVENT_ID`: Default event ID (default: "demo")
- `MOCKUP_AUTOSKIP_SECONDS`: Auto-skip tracks in demo (default: "0")
- `MOCKUP_NO_ACTUAL_PLAYING`: Disable actual Spotify playback (default: "false")
- `DEFAULT_AUTOFILL_EMPTY_PLAYLIST`: Auto-fill empty playlists (default: "true")

## Key Technical Details

### Infinispan Cache Configuration

Services create caches dynamically using REST API with XML config. Cache configuration includes:
- Distributed cache with SYNC mode
- 2 owners for redundancy
- Heap storage with max 10000 entries
- File store persistence with write-behind
- JSON encoding (`application/json`)

See `provider-spotify/app.js` for example cache creation.

### Authentication

- Spotify OAuth flow: Login endpoint redirects to Spotify auth, callback stores tokens in Infinispan
- Token refresh: Background job in provider-spotify refreshes expired tokens
- Event access: Configured per-event with passwords for owner/curator/user roles

### WebSocket Protocol

service-web Socket.IO path: `/api/service-web/socket`

Events emitted to clients:
- Playlist updates (throttled by `THROTTLE_EMITTER_PLAYLIST`)
- Activity events from Kafka
- User/curator statistics

### Shared Code

`components/common/EventActivityClient.js` is used across Node.js services to publish activity events to service-eventactivity.

## Deployment

The application is designed for OpenShift/Kubernetes deployment:
- Ansible playbooks in `install/openshift/`
- Component-specific OpenShift templates in `components/*/openshift/`
- Container images published to quay.io/opendj/*
- Pipeline configuration in `install/openshift/pipeline.yml`

## Running the Demo

Access the demo at: https://www.opendj.io/demo

For local development, ensure:
1. Infinispan is running (port 11222)
2. Kafka is running (port 9092) with topics created
3. Start services in order: service-eventactivity, provider-spotify, service-playlist, service-web
4. Start frontend-web
5. Access at http://localhost:8100 (or port shown by ionic serve)
