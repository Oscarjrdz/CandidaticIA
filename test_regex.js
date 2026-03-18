const msg2 = "si   ";
const _isAffirmativeCs = /^(s[ií]|claro|dale|por\s*favor|porfa|por\s*fa|[aá]ndale|andale|v[aá]|adelante|ok\s*dale|sale|va|quiero|me\s+interesa|s[ií]\s+quiero|perfecto|s[ií]\s+por\s+favor|de\s+una|obvio|claro\s+que\s+s[ií]|s[ií]\s+claro|si\s+quiero)\s*[!.]*$/i.test(msg2.trim());

console.log(_isAffirmativeCs);
