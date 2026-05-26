module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });

    const { query } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query required' });

    const fieldMask = [
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.internationalPhoneNumber',
        'places.websiteUri',
        'places.rating',
        'places.userRatingCount',
        'places.businessStatus',
        'places.types',
        'places.googleMapsUri'
    ].join(',');

    try {
        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': fieldMask
            },
            body: JSON.stringify({
                textQuery: query,
                languageCode: 'en-AU',
                regionCode: 'AU',
                maxResultCount: 1
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error?.message || 'Places API error' });
        }

        const place = data.places?.[0] || null;
        if (!place) return res.json({ found: false });

        return res.json({
            found: true,
            name: place.displayName?.text,
            formattedAddress: place.formattedAddress,
            phone: place.nationalPhoneNumber || place.internationalPhoneNumber,
            website: place.websiteUri,
            rating: place.rating,
            reviewCount: place.userRatingCount,
            businessStatus: place.businessStatus,
            types: place.types,
            mapsUrl: place.googleMapsUri
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
