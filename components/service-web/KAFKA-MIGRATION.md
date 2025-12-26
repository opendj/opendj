# Kafka Client Migration: kafka-node → KafkaJS

## Overview

The service-web component has been migrated from the deprecated `kafka-node` library to the modern `kafkajs` library.

## Why Migrate?

- **kafka-node** is deprecated and no longer maintained
- **KafkaJS** is the modern, actively maintained Kafka client for Node.js
- Better Kafka 2.x+ compatibility
- Improved performance and stability
- Better error handling and retry mechanisms

## Changes Made

### 1. Dependencies (package.json)

**Before:**
```json
"kafka-node": "^5.0.0",
"uuid": "old version"
```

**After:**
```json
"kafkajs": "^2.2.4",
"uuid": "^9.0.0"
```

### 2. Import Statements

**Before:**
```javascript
const kafka = require('kafka-node');
const uuid = require('uuid/v1');
```

**After:**
```javascript
const { Kafka, logLevel } = require('kafkajs');
const { v1: uuidv1 } = require('uuid');
```

### 3. Client Initialization

**Before (kafka-node):**
```javascript
var kafkaClient = new kafka.KafkaClient({
    kafkaHost: ENV_KAFKA_HOST,
    connectTimeout: 1000,
    requestTimeout: 500,
    autoConnect: true,
    connectRetryOptions: {
        retries: 10,
        // ...
    },
});

kafkaClient.on('error', function(err) { /* ... */ });
kafkaClient.on('connect', function(data) { /* ... */ });
```

**After (KafkaJS):**
```javascript
const kafka = new Kafka({
    clientId: 'opendj-service-web',
    brokers: ENV_KAFKA_HOST.split(','),
    connectionTimeout: 1000,
    requestTimeout: 500,
    retry: {
        retries: 10,
        factor: 1,
        minTimeout: 1000,
        maxTimeout: 1000,
        randomize: true,
    },
    logLevel: logLevel.ERROR,
});
```

**Note:** KafkaJS handles connections internally - no need for explicit connection listeners.

### 4. Topic Creation (Admin Operations)

**Before (kafka-node):**
```javascript
function kafkaCreateTopic(client, topicName) {
    const admin = new kafka.Admin(client);
    admin.createTopics(topics, (err, res) => {
        if (err) {
            log.error("kafka create topic failed", err);
        }
    });
}
```

**After (KafkaJS - async/await):**
```javascript
async function kafkaCreateTopic(kafka, topicName) {
    const admin = kafka.admin();
    try {
        await admin.connect();
        await admin.createTopics({
            topics: [{
                topic: topicName,
                numPartitions: parseInt(ENV_KAFKA_TOPIC_NUM_PARTITIONS),
                replicationFactor: parseInt(ENV_TOPIC_REPLICATION_FACTOR)
            }]
        });
        log.info("Successfully created topic: %s", topicName);
    } catch (err) {
        log.error("kafka create topic failed", err);
    } finally {
        await admin.disconnect();
    }
}
```

### 5. Consumer

**Before (kafka-node - event-based):**
```javascript
function startKafkaConsumer() {
    var kafkaConsumer = new kafka.Consumer(kafkaClient, [
        { topic: ENV_KAFKA_TOPIC_ACTIVITY }
    ], {
        groupId: uuid(),
        autoCommit: true,
    });

    kafkaConsumer.on('message', function(message) {
        let activity = JSON.parse(message.value);
        // process message...
    });

    kafkaConsumer.on('error', function(error) {
        // handle error...
    });
}
```

**After (KafkaJS - async/await):**
```javascript
async function startKafkaConsumer() {
    const consumer = kafka.consumer({
        groupId: `opendj-service-web-${uuidv1()}`,
        retry: {
            retries: 10,
        }
    });

    await consumer.connect();
    await consumer.subscribe({
        topic: ENV_KAFKA_TOPIC_ACTIVITY,
        fromBeginning: false
    });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            const activity = JSON.parse(message.value.toString());
            // process message...
        },
    });
}
```

## Environment Variables

All environment variables remain **unchanged**:

- `KAFKA_HOST` - Kafka broker addresses (comma-separated)
- `KAFKA_TOPIC_ACTIVITY` - Topic name for activity events
- `KAFKA_IGNORE_MISSING` - Ignore missing topic errors
- `KAFKA_TOPIC_NUM_PARTITIONS` - Number of partitions for topics
- `TOPIC_REPLICATION_FACTOR` - Replication factor

## Key Differences

### Broker Configuration

- **kafka-node**: `kafkaHost: "localhost:9092"`
- **KafkaJS**: `brokers: ["localhost:9092"]` (array)

The migration automatically handles this with `ENV_KAFKA_HOST.split(',')`.

### Message Value

- **kafka-node**: `message.value` is a string
- **KafkaJS**: `message.value` is a Buffer - use `.toString()`

### Error Handling

KafkaJS has more robust error handling:
- Automatic reconnection
- Better error types (e.g., `UNKNOWN_TOPIC_OR_PARTITION`)
- Graceful shutdown handling

### Reconnection Logic

The new implementation includes robust automatic reconnection when the Kafka broker fails:

**Features:**
- **Exponential Backoff**: Retry delay doubles with each attempt, up to 60 seconds max
- **Jitter**: Random 0-1 second delay added to prevent thundering herd
- **Event-Driven**: Automatically triggers on DISCONNECT and CRASH events
- **State Tracking**: Prevents multiple simultaneous reconnection attempts
- **Graceful Shutdown**: Disables reconnection during intentional shutdown

**Configuration:**
```javascript
// Consumer state tracking
let consumerInstance = null;
let isReconnecting = false;
let reconnectAttempts = 0;
let isShuttingDown = false;
const MAX_RECONNECT_ATTEMPTS = 100; // Effectively unlimited
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 60000; // 60 seconds
```

**Event Handlers:**
```javascript
consumer.on(consumer.events.DISCONNECT, () => {
    if (!isShuttingDown) {
        log.warn("Kafka consumer DISCONNECTED - attempting reconnection");
        reconnectConsumer();
    }
});

consumer.on(consumer.events.CRASH, ({ error, groupId }) => {
    if (!isShuttingDown) {
        log.error("Kafka consumer CRASHED - attempting reconnection");
        reconnectConsumer();
    }
});

consumer.on(consumer.events.CONNECT, () => {
    log.info("Kafka consumer CONNECTED successfully");
    reconnectAttempts = 0; // Reset counter
});
```

**Retry Pattern:**
- Attempt 1: ~1 second delay
- Attempt 2: ~2 seconds delay
- Attempt 3: ~4 seconds delay
- Attempt 4: ~8 seconds delay
- ...
- Attempt 7+: ~60 seconds delay (max)

### Graceful Shutdown

The new implementation includes proper cleanup on process termination:
```javascript
signalTraps.forEach(type => {
    process.once(type, async () => {
        isShuttingDown = true; // Prevent reconnection
        if (consumerInstance) {
            await consumerInstance.disconnect();
        }
        process.kill(process.pid, type);
    });
});
```

## Testing

### Installation

```bash
cd /Users/dfroehli/RedHat/projects/OpenDJ/components/service-web
npm install
```

### Run Service

```bash
npm start
```

### Verify Kafka Connection

Check logs for:
```
KafkaJS client initialized with brokers: localhost:9092
Kafka consumer connected
Kafka consumer subscribed to topic: opendj.event.activity
```

### Test with Local Kafka

```bash
# Start Kafka locally (if using Docker)
docker run -d --name kafka \
  -p 9092:9092 \
  -e KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181 \
  quay.io/strimzi/kafka:latest-kafka-3.5.0
```

## Migration Checklist

- [x] Updated package.json dependencies
- [x] Migrated client initialization
- [x] Migrated admin operations (topic creation)
- [x] Migrated consumer logic
- [x] Updated error handling
- [x] Added graceful shutdown
- [x] Maintained backward compatibility with environment variables
- [ ] Test with real Kafka cluster
- [ ] Monitor for any issues

## Rollback Plan

If issues arise, rollback by:

1. Revert `package.json`:
   ```bash
   git checkout HEAD -- package.json
   ```

2. Revert `server.js`:
   ```bash
   git checkout HEAD -- server.js
   ```

3. Reinstall dependencies:
   ```bash
   npm install
   ```

## Performance Considerations

KafkaJS generally provides:
- **Lower memory footprint** compared to kafka-node
- **Better throughput** for high-volume consumers
- **More predictable behavior** under load

## Troubleshooting

### Connection Issues

```
Error: Connection error: getaddrinfo ENOTFOUND
```

**Solution**: Check `KAFKA_HOST` environment variable.

### Topic Not Found

```
Error: UNKNOWN_TOPIC_OR_PARTITION
```

**Solution**: The service will automatically attempt to create the topic.

### Authentication Issues

If using SASL authentication, add to Kafka config:
```javascript
const kafka = new Kafka({
    // ...
    sasl: {
        mechanism: 'plain',
        username: process.env.KAFKA_USERNAME,
        password: process.env.KAFKA_PASSWORD,
    },
});
```

### Broker Disconnection

If the Kafka broker fails or becomes unavailable:

**Expected Behavior:**
```
Kafka consumer DISCONNECTED - attempting reconnection
Attempting to reconnect Kafka consumer (attempt 1) after 1234ms
Kafka consumer connected
Kafka consumer CONNECTED successfully
```

**Logs to Monitor:**
- `DISCONNECTED`: Consumer lost connection to broker
- `CRASHED`: Consumer encountered fatal error
- `Attempting to reconnect`: Automatic retry in progress
- `CONNECTED successfully`: Consumer recovered

**Configuration:**
- Adjust `MAX_RETRY_DELAY` to change maximum wait time between retries
- Adjust `INITIAL_RETRY_DELAY` to change initial retry delay
- Set `KAFKA_IGNORE_MISSING=true` to disable reconnection on initial failures

## References

- [KafkaJS Documentation](https://kafka.js.org/)
- [KafkaJS GitHub](https://github.com/tulios/kafkajs)
- [Migration Guide](https://kafka.js.org/docs/migration-guide)

## Support

For issues or questions, check:
1. KafkaJS documentation
2. OpenDJ GitHub issues
3. Kafka broker logs
