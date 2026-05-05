const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
const envLocal = dotenv.parse(fs.readFileSync('.env.local'));

async function testAdsComments() {
    const adsToken = envLocal.META_ADS_TOKEN;
    const pageToken = envLocal.META_ACCESS_TOKEN;

    console.log("Tokens exist:", !!adsToken, !!pageToken);

    // Get an ad ID to test. We can query the stats to get one ad ID.
    const redisRes = await fetch(`${envLocal.UPSTASH_REDIS_REST_URL}/get/ads_stats_cache`, {
        headers: { Authorization: `Bearer ${envLocal.UPSTASH_REDIS_REST_TOKEN}` }
    });
    const redisData = await redisRes.json();
    let stats = [];
    if (redisData.result) {
        stats = JSON.parse(redisData.result);
    }
    
    const testAd = stats.find(a => a.adId);
    if (!testAd) {
        console.log("No test ad found");
        return;
    }
    
    const adId = testAd.adId;
    console.log("Testing with adId:", adId);

    // Step 1: Get the post ID from the ad creative
    let postId = null;
    let fallbackHit = false;

    if (adsToken) {
        const adRes = await fetch(`https://graph.facebook.com/v21.0/${adId}?fields=creative{effective_object_story_id}&access_token=${adsToken}`);
        const adData = await adRes.json();
        console.log("Ad Data:", adData);

        if (!adData.error) {
            postId = adData?.creative?.effective_object_story_id;
        }

        if (!postId) {
            fallbackHit = true;
            const creativesRes = await fetch(`https://graph.facebook.com/v21.0/${adId}/adcreatives?fields=effective_object_story_id&access_token=${adsToken}`);
            const creativesData = await creativesRes.json();
            console.log("Creatives Data:", creativesData);
            if (creativesData.data?.[0]?.effective_object_story_id) {
                postId = creativesData.data[0].effective_object_story_id;
            }
        }
    }

    console.log("Resolved postId:", postId);
}

testAdsComments();
