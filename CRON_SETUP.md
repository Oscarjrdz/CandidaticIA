# Environment Variables for Backend Auto-Export

## Required Variables

Add these environment variables in Vercel Dashboard → Settings → Environment Variables:

### 1. CRON_SECRET
**Purpose**: Security token to prevent unauthorized cron execution  
**Value**: Generate a random secret (e.g., `openssl rand -hex 32`)  
**Example**: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6`

### 2. BUILDERBOT_BOT_ID
**Purpose**: Your BuilderBot bot ID  
**Value**: Copy from BuilderBot dashboard  
**Example**: `473949d6-a850-4ba3-8e62-f7965ccee8a5`

### 3. BUILDERBOT_ANSWER_ID
**Purpose**: Your BuilderBot answer ID  
**Value**: Copy from BuilderBot dashboard  
**Example**: `3cc8c38a-7cb0-478a-b3c4-e987d15ec278`

### 4. BUILDERBOT_API_KEY
**Purpose**: Your BuilderBot API key  
**Value**: Copy from BuilderBot dashboard  
**Example**: `bb-a0df09f9-449b-4436-83c3-bba1980d1e14`

### 5. EXPORT_TIMER_MINUTES (Optional)
**Purpose**: Minutes to wait after last message before exporting  
**Default**: `1`  
**Example**: `5`

### 6. REDIS_URL (Already configured)
**Purpose**: Upstash Redis connection for tracking exports  
**Note**: Should already be configured if using Upstash integration

## How to Add Variables in Vercel

1. Go to https://vercel.com
2. Select your project "candidatic-ia"
3. Go to Settings → Environment Variables
4. Add each variable:
   - Name: `CRON_SECRET`
   - Value: (your generated secret)
   - Environment: Production, Preview, Development (select all)
5. Click "Save"
6. Redeploy the project for changes to take effect

## Testing the Cron Job

After deployment, you can test the cron manually:

```bash
curl -X GET https://candidatic-ia.vercel.app/api/cron/export-chats \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected response:
```json
{
  "success": true,
  "processed": 5,
  "errors": 0,
  "remaining": 0,
  "total": 5
}
```

## Monitoring

View cron execution logs in Vercel:
1. Go to your project dashboard
2. Click "Deployments"
3. Click on the latest deployment
4. Click "Functions" tab
5. Find `/api/cron/export-chats`
6. View execution logs

## Troubleshooting

### Cron not running
- Verify `vercel.json` has the cron configuration
- Check that CRON_SECRET is set in environment variables
- Redeploy after adding environment variables

### Unauthorized errors
- Verify CRON_SECRET matches in both code and Vercel settings
- Check Authorization header format: `Bearer YOUR_SECRET`

### No candidates processed
- Check EXPORT_TIMER_MINUTES setting
- Verify candidates have recent messages
- Check Redis connection (REDIS_URL)

### Upload failures
- Verify BuilderBot credentials (BOT_ID, ANSWER_ID, API_KEY)
- Check BuilderBot API status
- Review function logs for specific errors
