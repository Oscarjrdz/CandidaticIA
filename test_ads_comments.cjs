const fs = require('fs');
const dotenv = require('dotenv');

const envLocal = dotenv.parse(fs.readFileSync('.env.local'));

async function testAdsComments() {
    const adsToken = envLocal.META_ADS_TOKEN;
    const pageToken = envLocal.META_ACCESS_TOKEN;
    const adAccountId = envLocal.META_AD_ACCOUNT_ID;

    // fetch an ad id
    const adsRes = await fetch(`https://graph.facebook.com/v21.0/act_${adAccountId}/ads?fields=id,name&limit=1&access_token=${adsToken}`);
    const adsData = await adsRes.json();
    
    const adId = adsData.data?.[0]?.id;
    let postId = null;

    if (adsToken) {
        const adRes = await fetch(`https://graph.facebook.com/v21.0/${adId}?fields=creative{effective_object_story_id}&access_token=${adsToken}`);
        const adData = await adRes.json();
        if (!adData.error) {
            postId = adData?.creative?.effective_object_story_id;
        }
        if (!postId) {
            const creativesRes = await fetch(`https://graph.facebook.com/v21.0/${adId}/adcreatives?fields=effective_object_story_id&access_token=${adsToken}`);
            const creativesData = await creativesRes.json();
            if (creativesData.data?.[0]?.effective_object_story_id) {
                postId = creativesData.data[0].effective_object_story_id;
            }
        }
    }

    console.log("Resolved postId:", postId);

    if (postId) {
        let commentsToken = pageToken || adsToken;
        let commentsRes = await fetch(
            `https://graph.facebook.com/v21.0/${postId}/comments?fields=id,message,from,created_time,comment_count,like_count,attachment&limit=5&order=reverse_chronological&access_token=${commentsToken}`
        );
        let commentsData = await commentsRes.json();
        
        console.log("Final Comments Response:", JSON.stringify(commentsData, null, 2));
    }
}

testAdsComments();
