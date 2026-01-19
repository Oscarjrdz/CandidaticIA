# Environment Variables for Backend Auto-Export

## Required Variables

Add these environment variables in Vercel Dashboard → Settings → Environment Variables:

### 1. CRON_SECRET (Required)
**Purpose**: Security token to prevent unauthorized cron execution  
**Value**: Generate a random secret (e.g., `openssl rand -hex 32`)  
**Example**: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6`

### 2. REDIS_URL (Already configured)
**Purpose**: Upstash Redis connection for storing settings and tracking exports  
**Note**: Should already be configured if using Upstash integration

## Settings from Database

The following settings are read from Redis (configured in the frontend Settings section):

- ✅ **BuilderBot Bot ID** - Configured in Settings → Update Bot
- ✅ **BuilderBot Answer ID** - Configured in Settings → Update Bot  
- ✅ **BuilderBot API Key** - Configured in Settings → Update Bot
- ✅ **Export Timer** - Configured in Candidatos section

**No need to add these as environment variables!** The cron job reads them from the same database as the frontend.

## How to Add CRON_SECRET in Vercel

1. Generate a secret:
   ```bash
   openssl rand -hex 32
   ```

2. Go to https://vercel.com
3. Select your project "candidatic-ia"
4. Go to Settings → Environment Variables
5. Add variable:
   - Name: `CRON_SECRET`
   - Value: (your generated secret)
   - Environment: Production, Preview, Development (select all)
6. Click "Save"
7. Redeploy the project for changes to take effect

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
