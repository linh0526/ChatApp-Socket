# Backend Setup Notes

## Message Encryption

Messages are encrypted before being persisted to the database. Provide a secret key via the `MESSAGE_ENCRYPTION_KEY` environment variable (32+ random characters recommended). Example:

```
MESSAGE_ENCRYPTION_KEY=replace_with_a_secure_random_string
```

If not supplied, the server falls back to a development-only key; do not use that default in production environments.

## Voice Message Storage

Voice recordings uploaded from the frontend are stored under `backend/uploads/voice`. The directory is served statically at `/uploads`, so a file saved at `backend/uploads/voice/<userId>/<file>` can be downloaded from `/uploads/voice/<userId>/<file>`.

- Configure the maximum upload size (in bytes) with `VOICE_UPLOAD_MAX_SIZE` (default: 10 MB).
- Uploaded files are grouped by authenticated user ID to avoid filename collisions.
- The API endpoint for uploads is `POST /api/messages/voice` with raw audio data (`Content-Type: audio/webm`, `audio/ogg`, v.v.).

