import { EmbedBuilder, ActionRowBuilder } from "discord.js";
import { createBaseActionButton, createBaseEmbed, createBaseUrlButton } from "./base_embeds.js";
import Logger from "../../utils/logger.js";

function getNumberOfStars(rating) {
    rating = rating * 5;
    rating = Math.round(rating);

    const stars = '⭐️'.repeat(rating);
    return stars;
}

function getFlagEmoji(countryCode) {
    if (countryCode === 'uk') {
        return '🇬🇧';
    }

    return countryCode.toUpperCase().replace(/./g, char => 
        String.fromCodePoint(127397 + char.charCodeAt())
    );
  }

function replaceDomainInUrl(url, domain) {
    return url.replace(/vinted\.(.*?)\//, `vinted.${domain}/`);
}

export async function createVintedItemEmbed(item, domain = "fr") {
    const itemUrl = replaceDomainInUrl(item.url, domain);
    const sellerUrl = item.user?.url ? replaceDomainInUrl(item.user.url, domain) : itemUrl;
    const nowUnix = Math.floor(Date.now() / 1000);

    const priceText = (item.totalItemPrice && item.totalItemPrice !== item.priceNumeric)
        ? `${item.priceNumeric} ${item.currency}\n*(Total: ${item.totalItemPrice} ${item.currency})*`
        : `${item.priceNumeric} ${item.currency}`;

    const descriptionText = `**[View item](${itemUrl})** • **[Seller Profile](${sellerUrl})**\n\n📝 ${item.description || 'No description provided.'}`;

    const embed = new EmbedBuilder()
        .setTitle(item.title)
        .setURL(itemUrl)
        .setDescription(descriptionText)
        .setColor(0x007782)
        .setTimestamp();

    embed.setFields([
        { name: '💰 Price', value: priceText, inline: true },
        { name: '📏 Size', value: `${item.size}`, inline: true },
        { name: '🏷️ Brand', value: `${item.brand}`, inline: true },
        { name: '📦 Condition', value: `${item.status}`, inline: true },
        { name: '🌍 Country', value: item.user ? getFlagEmoji(item.user.countryCode) : 'N/A', inline: true },
        { name: '⏰ Detected', value: `<t:${nowUnix}:R>`, inline: true },
    ]);

    const photosEmbeds = [];

    // Add first photo
    const firstPhoto = item.photos[0];
    if (firstPhoto && firstPhoto.fullSizeUrl) {
        embed.setImage(firstPhoto.fullSizeUrl);
    }

    // Attach up to 2 secondary images (photos[1] and photos[2]) to create an image carousel
    for (let i = 1; i < item.photos.length && i < 3; i++) {
        const photo = item.photos[i];
        if (photo && photo.fullSizeUrl) {
            const photoEmbed = new EmbedBuilder()
                .setURL(itemUrl)
                .setImage(photo.fullSizeUrl);
            photosEmbeds.push(photoEmbed);
        }
    }

    return { embed, photosEmbeds };
}

export async function createVintedItemActionRow(item, domain) {
    const actionRow = new ActionRowBuilder();

    const sendMessageUrl = `https://www.vinted.${domain}/items/${item.id}/want_it/new?button_name=receiver_id=${item.id}`;
    const buyUrl = `https://www.vinted.${domain}/transaction/buy/new?source_screen=item&transaction%5Bitem_id%5D=${item.id}`;

    actionRow.addComponents(
        await createBaseUrlButton("🔗 View on Vinted", replaceDomainInUrl(item.url, domain)),
        await createBaseUrlButton("📨 Send Message", sendMessageUrl),
        await createBaseUrlButton("💸 Buy", buyUrl)
    );

    return actionRow;
}
