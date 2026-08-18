// Validation functions as standalone utilities
function validateId(value) {
    return (typeof value === 'number' && value > 0) ? value : 0;
}

function validateNumber(value) {
    if (typeof value === 'number' && !isNaN(value)) return value;
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}

function validateString(value, fallback = "N/D") {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    if (value && typeof value === 'object') {
        if (typeof value.title === 'string' && value.title.trim()) return value.title.trim();
        if (typeof value.name === 'string' && value.name.trim()) return value.name.trim();
    }
    return fallback;
}

function validateBoolean(value) {
    return (typeof value === 'boolean') ? value : false;
}

function validateUrl(value) {
    if (!value || typeof value !== 'string') return "N/D";
    try {
        new URL(value);
        return value;
    } catch (error) {
        return "N/D";
    }
}

function parseDate(value) {
    if (!value) return new Date(0);
    const parsedDate = new Date(value);
    return isNaN(parsedDate.getTime()) ? new Date(0) : parsedDate;
}

class VintedPhoto {
    constructor(photo) {
        if (typeof photo === 'string') {
            this.id = 0;
            this.imageNo = 1;
            this.width = 0;
            this.height = 0;
            this.url = validateUrl(photo);
            this.dominantColor = "#007782";
            this.fullSizeUrl = validateUrl(photo);
            return;
        }

        this.id = validateId(photo?.id);
        this.imageNo = validateNumber(photo?.image_no);
        this.width = validateNumber(photo?.width);
        this.height = validateNumber(photo?.height);
        this.url = photo?.url ? validateUrl(photo.url) : (photo?.full_size_url ? validateUrl(photo.full_size_url) : "N/D");
        this.dominantColor = validateString(photo?.dominant_color, "#007782");
        this.fullSizeUrl = photo?.full_size_url ? validateUrl(photo.full_size_url) : (photo?.url ? validateUrl(photo.url) : "N/D");
    }
}

const ISO_COUNTRY_MAP = {
  FR: { flag: '🇫🇷', code: 'FR', name: 'France' },
  ES: { flag: '🇪🇸', code: 'ES', name: 'Spain' },
  IT: { flag: '🇮🇹', code: 'IT', name: 'Italy' },
  DE: { flag: '🇩🇪', code: 'DE', name: 'Germany' },
  NL: { flag: '🇳🇱', code: 'NL', name: 'Netherlands' },
  PL: { flag: '🇵🇱', code: 'PL', name: 'Poland' },
  BE: { flag: '🇧🇪', code: 'BE', name: 'Belgium' },
  PT: { flag: '🇵🇹', code: 'PT', name: 'Portugal' },
  AT: { flag: '🇦🇹', code: 'AT', name: 'Austria' },
  GB: { flag: '🇬🇧', code: 'UK', name: 'United Kingdom' },
  UK: { flag: '🇬🇧', code: 'UK', name: 'United Kingdom' },
  CZ: { flag: '🇨🇿', code: 'CZ', name: 'Czechia' },
  SK: { flag: '🇸🇰', code: 'SK', name: 'Slovakia' },
  LT: { flag: '🇱🇹', code: 'LT', name: 'Lithuania' },
  SE: { flag: '🇸🇪', code: 'SE', name: 'Sweden' },
  DK: { flag: '🇩🇰', code: 'DK', name: 'Denmark' },
  RO: { flag: '🇷🇴', code: 'RO', name: 'Romania' },
  HU: { flag: '🇭🇺', code: 'HU', name: 'Hungary' },
  HR: { flag: '🇭🇷', code: 'HR', name: 'Croatia' },
  FI: { flag: '🇫🇮', code: 'FI', name: 'Finland' },
  IE: { flag: '🇮🇪', code: 'IE', name: 'Ireland' },
  LU: { flag: '🇱🇺', code: 'LU', name: 'Luxembourg' }
};

const VINTED_COUNTRY_ID_MAP = {
  1: 'FR', 2: 'BE', 3: 'UK', 4: 'ES', 7: 'DE', 8: 'AT', 10: 'NL',
  11: 'PT', 13: 'PL', 16: 'IT', 22: 'CZ', 23: 'SK', 24: 'LT',
  26: 'SE', 27: 'DK', 30: 'RO', 31: 'HU', 33: 'HR', 35: 'FI', 37: 'IE', 43: 'LU'
};

function resolveItemCountry(item) {
  if (!item) return '🇮🇹 IT';
  const isoCode = (
    item.country ||
    item.country_code ||
    item.country_iso_code ||
    item.user?.country_iso_code ||
    item.user?.country_code ||
    ''
  ).toUpperCase().trim();
  if (isoCode && ISO_COUNTRY_MAP[isoCode]) {
    return `${ISO_COUNTRY_MAP[isoCode].flag} ${ISO_COUNTRY_MAP[isoCode].code}`;
  }
  const countryId = item.countryId || item.country_id || item.user?.country_id;
  if (countryId && VINTED_COUNTRY_ID_MAP[countryId]) {
    const mappedIso = VINTED_COUNTRY_ID_MAP[countryId];
    return `${ISO_COUNTRY_MAP[mappedIso].flag} ${ISO_COUNTRY_MAP[mappedIso].code}`;
  }
  return '🇮🇹 IT';
}

function resolveSellerRating(user) {
  if (!user) return 'No reviews';
  const feedbackCount = user.feedback_count || user.reviews_count || 0;
  const reputation = user.feedback_reputation;
  if (feedbackCount === 0 || reputation === undefined || reputation === null) {
    return 'No reviews';
  }
  const starRating = (reputation * 5.0).toFixed(1);
  return `⭐ ${starRating} (${feedbackCount})`;
}

const VINTED_PLATFORM_MAP = {
    1273: 'Nintendo Switch',
    1281: 'PS5',
    6478: 'Nintendo Switch 2',
    1280: 'PS4'
};

function resolvePlatform(item) {
    if (!item) return '--';
    const pId = item.video_game_platform_id || item.platform_id || item.video_game_platform?.id || item.platformId || item.videoGamePlatformId;

    if (pId && VINTED_PLATFORM_MAP[pId]) {
        return VINTED_PLATFORM_MAP[pId];
    }
    
    const fallbackTitle = item.video_game_platform_title || item.platform_title || item.video_game_platform?.title || (typeof item.video_game_platform === 'string' ? item.video_game_platform : null) || (typeof item.platform === 'string' ? item.platform : null);
    if (fallbackTitle && fallbackTitle !== 'N/D' && fallbackTitle !== 'N/A') {
        return fallbackTitle;
    }
    return '--';
}

class VintedUser {
    constructor(userData = {}) {
        this.id = validateId(userData.id);
        this.login = validateString(userData.login || userData.username, "Anonymous");
        this.feedback_reputation = validateNumber(userData.feedback_reputation);
        this.feedback_count = validateNumber(userData.feedback_count || userData.positive_feedback_count || userData.feedback_reputation_count);
        this.positive_feedback_count = this.feedback_count;
        this.country_code = validateString(userData.country_code || userData.country_iso_code || userData.country_title || userData.country, "").toUpperCase();
        this.countryCode = this.country_code;

        this.photo = userData.photo ? new VintedPhoto(userData.photo) : "https://upload.wikimedia.org/wikipedia/commons/9/99/Sample_User_Icon.png";
        this.url = validateUrl(userData.profile_url);
    }
}

class VintedItem {
    constructor(itemData = {}) {
        this.id = validateId(itemData.id);
        this.title = validateString(itemData.title, "Untitled");
        this.url = validateUrl(itemData.url);
        this.brandId = validateId(itemData.brand_id);
        this.sizeId = validateId(itemData.size_id);
        this.statusId = validateId(itemData.status_id);
        this.userId = validateId(itemData.user_id || itemData.user?.id);

        // Platform attribute extraction
        this.platform_id = validateId(itemData.video_game_platform_id || itemData.platform_id);
        let platformVal = resolvePlatform(itemData);
        if (platformVal === "N/A" && itemData.item_attributes && Array.isArray(itemData.item_attributes)) {
            const platformAttr = itemData.item_attributes.find(a => a.code === "video_game_platform" || a.code === "platform");
            if (platformAttr) {
                const attrId = platformAttr.ids?.[0] || platformAttr.id;
                if (attrId && VINTED_PLATFORM_MAP[attrId]) {
                    platformVal = VINTED_PLATFORM_MAP[attrId];
                } else {
                    platformVal = platformAttr.title || platformAttr.value || "N/A";
                }
            }
        }
        this.platform = validateString(platformVal, "N/A");
        this.video_game_platform = this.platform;
        this.videoGamePlatform = this.platform;

        // Country extraction
        this.country_code = validateString(
            itemData.country || 
            itemData.user?.country_code || 
            itemData.user?.country_iso_code || 
            itemData.country_code || 
            itemData.country_title || 
            itemData.user?.country_title, 
            ""
        ).toUpperCase();
        this.country = this.country_code;

        this.countryId = validateId(itemData.country_id || itemData.user?.country_id);
        this.catalogId = validateId(itemData.catalog_id);

        this.description = validateString(itemData.description, "No description provided.");
        
        // Brand, Size, Status mapping supporting strings and objects
        this.brand_title = validateString(itemData.brand_title || itemData.brand?.title || itemData.brand, "N/D");
        this.brand = this.brand_title;

        this.size_title = validateString(itemData.size_title || itemData.size?.title || itemData.size, "N/D");
        this.size = this.size_title;

        this.status_title = validateString(itemData.status_title || itemData.status?.title || itemData.status, "N/D");
        this.status = this.status_title;

        this.label = validateString(itemData.label, "N/D");
        this.currency = validateString(itemData.currency || itemData.price?.currency_code || itemData.price?.currency, "EUR");
        
        // Price numeric mapping
        const rawPrice = itemData.price_numeric !== undefined ? itemData.price_numeric : (itemData.price?.amount !== undefined ? itemData.price.amount : itemData.price);
        this.priceNumeric = validateNumber(rawPrice);

        // Extract total_item_price (fee-inclusive) if present
        if (itemData.total_item_price) {
            if (typeof itemData.total_item_price === 'object') {
                this.totalItemPrice = validateNumber(itemData.total_item_price.amount || itemData.total_item_price.numeric);
            } else {
                this.totalItemPrice = validateNumber(itemData.total_item_price);
            }
        } else if (itemData.total_item_price_numeric) {
            this.totalItemPrice = validateNumber(itemData.total_item_price_numeric);
        } else {
            this.totalItemPrice = null;
        }

        this.updatedAtTs = parseDate(itemData.updated_at_ts || itemData.photo?.high_resolution?.timestamp);
        this.colorId = validateId(itemData.color1_id);

        this.unixUpdatedAt = Math.floor((this.updatedAtTs.getTime() || Date.now()) / 1000);
        this.unixUpdatedAtString = `<t:${this.unixUpdatedAt}:R>`;

        // Create photo objects supporting photos array or single photo object
        if (Array.isArray(itemData.photos) && itemData.photos.length > 0) {
            this.photos = itemData.photos.map(photo => new VintedPhoto(photo));
        } else if (itemData.photo) {
            this.photos = [new VintedPhoto(itemData.photo)];
        } else {
            this.photos = [];
        }

        // Create user object
        this.user = itemData.user ? new VintedUser(itemData.user) : null;
        this.catalogBranchTitle = validateString(itemData.catalog_branch_title, "N/D");
    }

    getNumericStars() {
        return this.user ? this.user.feedback_reputation : 0;
    }

    getDominantColor() {
        if (this.photos.length === 0) {
            return "#007782";
        }
        return this.photos[0].dominantColor || "#007782";
    }
}

export { VintedItem, VintedPhoto, VintedUser, ISO_COUNTRY_MAP, VINTED_COUNTRY_ID_MAP, resolveItemCountry, resolveSellerRating, resolvePlatform, VINTED_PLATFORM_MAP };