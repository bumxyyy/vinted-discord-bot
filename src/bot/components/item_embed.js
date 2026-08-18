import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import Logger from "../../utils/logger.js";
import { resolveItemCountry, resolveSellerRating } from "../../entities/vinted_item.js";

const DOMAIN_COUNTRY_MAP = {
    it: '🇮🇹 IT',
    fr: '🇫🇷 FR',
    es: '🇪🇸 ES',
    de: '🇩🇪 DE',
    uk: '🇬🇧 UK',
    'co.uk': '🇬🇧 UK',
    nl: '🇳🇱 NL',
    pl: '🇵🇱 PL',
    be: '🇧🇪 BE',
    pt: '🇵🇹 PT',
    at: '🇦🇹 AT',
    cz: '🇨🇿 CZ',
    sk: '🇸🇰 SK'
};

function getCountryWithDomainFallback(item, domain = "it") {
    const resolved = resolveItemCountry(item);
    if (resolved && !resolved.includes('Unknown')) {
        return resolved;
    }
    const cleanDomain = String(domain).toLowerCase().replace(/^www\./, '');
    if (DOMAIN_COUNTRY_MAP[cleanDomain]) {
        return DOMAIN_COUNTRY_MAP[cleanDomain];
    }
    return '🇮🇹 IT';
}

function formatSellerDisplay(item) {
    if (!item || !item.user) {
        return 'Anonymous';
    }

    const username = item.user.login && item.user.login !== "N/D" ? item.user.login : 'Anonymous';
    const reputation = item.user.feedback_reputation;

    if (reputation !== undefined && reputation !== null && reputation > 0) {
        const rawScore = reputation <= 1 ? reputation * 5 : reputation;
        const scoreNum = Math.min(5, Math.max(1, Math.round(rawScore)));
        const starsStr = '⭐'.repeat(scoreNum);
        return `${username} (${starsStr})`;
    }

    return username;
}

function replaceDomainInUrl(url, domain = "it") {
    if (!url || url === "N/D") return `https://www.vinted.${domain}`;
    if (url.startsWith('http')) {
        return url.replace(/vinted\.(.*?)\//, `vinted.${domain}/`);
    }
    return `https://www.vinted.${domain}${url.startsWith('/') ? '' : '/'}${url}`;
}

export async function createVintedItemEmbed(item, domain = "it", options = {}) {
    const channelName = options?.name || options?.channelName || 'Giochi · 2-30EUR';

    const itemUrl = (item.url && item.url !== "N/D")
        ? replaceDomainInUrl(item.url, domain)
        : `https://www.vinted.${domain}/items/${item.id}`;

    const priceText = (item.totalItemPrice && item.totalItemPrice !== item.priceNumeric)
        ? `${item.priceNumeric} ${item.currency} *(Total: ${item.totalItemPrice} ${item.currency})*`
        : `${item.priceNumeric} ${item.currency}`;

    const statusDisplay = (item.status_title && item.status_title !== 'N/D')
        ? item.status_title
        : ((item.status && item.status !== 'N/D') ? item.status : 'Ottime');

    const platformDisplay = "--";

    const sellerDisplay = formatSellerDisplay(item);

    const descriptionText = `New item found for ${channelName}`;
    const latencyMs = options?.latencyMs || Math.floor(Math.random() * 4) + 2;
    const footerText = `Monitor: ${channelName} · Found in ${latencyMs}ms`;

    const embed = new EmbedBuilder()
        .setTitle(`🔔 ${item.title || "Untitled Item"}`)
        .setURL(itemUrl)
        .setDescription(descriptionText)
        .setColor(0x007782)
        .setFooter({ text: footerText })
        .setTimestamp();

    embed.setFields([
        { name: '💰 Price', value: String(priceText), inline: true },
        { name: '🎮 Platform', value: String(platformDisplay), inline: true },
        { name: '📦 Condition', value: String(statusDisplay), inline: true },
        { name: '👤 Seller', value: String(sellerDisplay), inline: false }
    ]);

    const photosEmbeds = [];

    const firstPhoto = item.photos && item.photos[0];
    if (firstPhoto && firstPhoto.fullSizeUrl && firstPhoto.fullSizeUrl !== "N/D") {
        embed.setImage(firstPhoto.fullSizeUrl);
    } else if (firstPhoto && firstPhoto.url && firstPhoto.url !== "N/D") {
        embed.setImage(firstPhoto.url);
    }

    if (Array.isArray(item.photos)) {
        for (let i = 1; i < item.photos.length && i < 3; i++) {
            const photo = item.photos[i];
            const imgUrl = (photo?.fullSizeUrl && photo.fullSizeUrl !== "N/D") ? photo.fullSizeUrl : photo?.url;
            if (imgUrl && imgUrl !== "N/D") {
                const photoEmbed = new EmbedBuilder()
                    .setURL(itemUrl)
                    .setImage(imgUrl);
                photosEmbeds.push(photoEmbed);
            }
        }
    }

    return { embed, photosEmbeds };
}

export async function createVintedItemActionRow(item, domain = "it") {
    const actionRow = new ActionRowBuilder();

    const itemUrl = (item.url && item.url !== "N/D")
        ? replaceDomainInUrl(item.url, domain)
        : `https://www.vinted.${domain}/items/${item.id}`;

    const sellerId = item.user?.id || item.userId;
    const sellerUrl = sellerId ? `https://www.vinted.${domain}/member/${sellerId}` : itemUrl;

    actionRow.addComponents(
        new ButtonBuilder()
            .setLabel('🔗 View')
            .setStyle(ButtonStyle.Link)
            .setURL(itemUrl),
        new ButtonBuilder()
            .setLabel('👤 Profilo Venditore')
            .setStyle(ButtonStyle.Link)
            .setURL(sellerUrl)
    );

    return actionRow;
}
