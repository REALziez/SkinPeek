import {getBuddy, getBundle, getCard, getSkin, getSpray, getTitle, getRarity} from "../valorant/cache.js";
import {
    emojiToString,
    skinNameAndEmoji,
    collectionSkinNameAndEmoji,
    escapeMarkdown,
    itemTypes,
    removeAlertActionRow,
    removeAlertButton,
    fetchChannel,
    fetch
} from "../misc/util.js";
import config from "../misc/config.js";
import {l, s} from "../misc/languages.js";
import {MessageActionRow, MessageButton} from "discord.js";
import {getStatsFor} from "../misc/stats.js";
import {getUser} from "../valorant/auth.js";
import {readUserJson, saveUser} from "../valorant/accountSwitcher.js";
import {getSetting, humanifyValue, settingName} from "../misc/settings.js";
import { json } from "express";


export const VAL_COLOR_1 = 0xFD4553;
export const VAL_COLOR_2 = 0x202225;
export const VAL_COLOR_3 = 0xEAEEB2;

const thumbnails = [
    "https://media.valorant-api.com/sprays/290565e7-4540-5764-31da-758846dc2a5a/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/31ba7f82-4fcb-4cbb-a719-06a3beef8603/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/fef66645-4e35-ff38-1b7c-799dd5fc7468/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/02f4c1db-46bb-a572-e830-0886edbb0981/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/40222bb5-4fce-9320-f4f1-95861df83c47/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/a7e1a9b6-4ab5-e6f7-e5fe-bc86f87b44ee/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/09786b0a-4c3e-5ba8-46ab-c49255620a5f/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/7b0e0c8d-4f91-2a76-19b9-079def2fa843/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/ea087a08-4b9f-bd0d-15a5-d3ba09c4c381/fulltransparenticon.png",
    "https://media.valorant-api.com/sprays/40ff9251-4c11-b729-1f27-088ee032e7ce/fulltransparenticon.png"
];

export const authFailureMessage = (interaction, authResponse, message, hideEmail=false) => {
    let embed;

    if(authResponse.maintenance) embed = basicEmbed(s(interaction).error.MAINTENANCE);
    else if(authResponse.mfa) {
        console.log(`${interaction.user.tag} needs 2FA code`);
        if(authResponse.method === "email") {
            if(hideEmail) embed = basicEmbed(s(interaction).info.MFA_EMAIL_HIDDEN);
            else embed = basicEmbed(s(interaction).info.MFA_EMAIL.f({e: escapeMarkdown(authResponse.email)}));
        }
        else embed = basicEmbed(s(interaction).info.MFA_GENERIC);
    }
    else if(authResponse.rateLimit) {
        console.log(`${interaction.user.tag} got rate-limited`);
        if(typeof authResponse.rateLimit === "number") embed = basicEmbed(s(interaction).error.LOGIN_RATELIMIT_UNTIL.f({t: Math.ceil(authResponse.rateLimit / 1000)}));
        else embed = basicEmbed(s(interaction).error.LOGIN_RATELIMIT);
    }
    else {
        embed = basicEmbed(message);

        // two-strike system
        const user = getUser(interaction.user.id);
        if(user) {
            user.authFailures++;
            saveUser(user);
        }
    }

    return {
        embeds: [embed],
        ephemeral: true
    }
}

export const skinChosenEmbed = async (interaction, skin) => {
    const channel = interaction.channel || await fetchChannel(interaction.channelId);
    let description = s(interaction).info.ALERT_SET.f({s: await skinNameAndEmoji(skin, channel, interaction.locale)});
    if(config.fetchSkinPrices && !skin.price) description += s(interaction).info.ALERT_BP_SKIN;
    return {
        description: description,
        color: VAL_COLOR_1,
        thumbnail: {
            url: skin.icon
        }
    }
}

export const renderOffers = async (shop, interaction, valorantUser, VPemoji, otherId=null) => {
    const forOtherUser = otherId && otherId !== interaction.user.id;
    const otherUserMention = `<@${otherId}>`;

    if(!shop.success) {
        let errorText;

        if(forOtherUser) errorText = s(interaction).error.AUTH_ERROR_SHOP_OTHER.f({u: otherUserMention});
        else errorText = s(interaction).error.AUTH_ERROR_SHOP;

        return authFailureMessage(interaction, shop, errorText);
    }

    let headerText;
    if(forOtherUser) {
        const json = readUserJson(otherId);

        let usernameText = otherUserMention;
        if(json.accounts.length > 1) usernameText += ' ' + s(interaction).info.SWITCH_ACCOUNT_BUTTON.f({n: json.currentAccount});

        headerText = s(interaction).info.SHOP_HEADER.f({u: usernameText, t: shop.expires});
    }
    else headerText = s(interaction).info.SHOP_HEADER.f({u: valorantUser.username, t: shop.expires}, interaction);

    const embeds = [basicEmbed(headerText)];

    const emojiString = emojiToString(VPemoji) || s(interaction).info.PRICE;

    for(const uuid of shop.offers) {
        const skin = await getSkin(uuid);
        const embed = await skinEmbed(skin.uuid, skin.price, interaction, emojiString);
        embeds.push(embed);
    }

    let components;
    if(forOtherUser) components = null;
    else components = switchAccountButtons(interaction, "shop", true);

    return {
        embeds, components
    };
}

export const renderCollection = async (collection, interaction, valorantUser, VPemoji, otherId=null, totalPrice, pageIndex=0) => {
    const forOtherUser = otherId && otherId !== interaction.user.id;
    const otherUserMention = `<@${otherId}>`;
    if(!collection.success) {
        let errorText;

        if(forOtherUser) errorText = s(interaction).error.AUTH_ERROR_SHOP_OTHER.f({u: otherUserMention});
        else errorText = s(interaction).error.AUTH_ERROR_SHOP;

        return authFailureMessage(interaction, collection, errorText);
    }

    if(totalPrice == null){
    totalPrice = await getCollectionValue(collection.offers, interaction);
    }

    let headerText;
    if(forOtherUser) {
        const json = readUserJson(otherId);

        let usernameText = otherUserMention;
        if(json.accounts.length > 1) usernameText += ' ' + s(interaction).info.SWITCH_ACCOUNT_BUTTON.f({n: json.currentAccount});

        headerText = s(interaction).info.COLLECTION_HEADER.f({u: usernameText, t: totalPrice, p: totalPrice/100});
    }
    else headerText = s(interaction).info.COLLECTION_HEADER.f({u: valorantUser.username, t: totalPrice, p: totalPrice/100}, interaction);

    const emojiString = emojiToString(VPemoji) || s(interaction).info.PRICE;

    const maxPages = Math.ceil(collection.offers.length / 9);

    if(pageIndex < 0) pageIndex = maxPages - 1;
    if(pageIndex >= maxPages) pageIndex = 0;
    const skinsToDisplay = Object.keys(collection.offers).slice(pageIndex * 9, pageIndex * 9 + 9);
    const embeds = [basicEmbed(headerText)];

    for (const poob of skinsToDisplay) {
        const uuid = collection.offers[poob];
        const req = await fetch(`https://valorant-api.com/v1/weapons/skins/${uuid}`, {
        });
        const json = JSON.parse(req.body);
        const rarity = await getRarity(json.data.contentTierUuid, interaction.channel);
        const skin = await getSkin(json.data.levels[0].uuid);
        var price;
        if (rarity.name == "Select"){
            price = 875;
        } else if (rarity.name == "Deluxe"){
            price = 1275;
        } else if (rarity.name == "Premium"){
            price = 1775;
        } else {
            price = skin.price;
        }

        embeds.push(await collectionEmbed(json.data, interaction, price, emojiString));
    }

    return {
        embeds: embeds,
        components: [pageButtons("changecollectionpage", interaction.user.id, pageIndex, maxPages, totalPrice)]
    }
}

const getCollectionValue = async (collectionOffers, interaction) => {
    var totalPrice = 0;

    for (const uuid of collectionOffers) {
        const req = await fetch(`https://valorant-api.com/v1/weapons/skins/${uuid}`, {
        });
        const json = JSON.parse(req.body);
        const rarity = await getRarity(json.data.contentTierUuid, interaction.channel);
        const skin = await getSkin(json.data.levels[0].uuid);
        var price;
        if (rarity.name == "Select"){
            price = 875;
        } else if (rarity.name == "Deluxe"){
            price = 1275;
        } else if (rarity.name == "Premium"){
            price = 1775;
        } else {
            price = skin.price;
        }
        totalPrice += Number(price);
    }
    return totalPrice;
}


export const renderBundles = async (bundles, interaction, VPemoji) => {
    if(!bundles.success) return authFailureMessage(interaction, bundles, s(interaction).error.AUTH_ERROR_BUNDLES);

    bundles = bundles.bundles;

    if(bundles.length === 1) {
        const bundle = await getBundle(bundles[0].uuid);

        const renderedBundle = await renderBundle(bundle, interaction, VPemoji, false);
        const titleEmbed = renderedBundle.embeds[0];
        titleEmbed.title = s(interaction).info.BUNDLE_HEADER.f({b: titleEmbed.title});
        titleEmbed.description += ` *(${s(interaction).info.EXPIRES.f({t: bundle.expires})})*`;

        return renderedBundle;
    }

    const emojiString = emojiToString(VPemoji) || s(interaction).info.PRICE;

    const embeds = [{
        title: s(interaction).info.BUNDLES_HEADER,
        description: s(interaction).info.BUNDLES_HEADER_DESC,
        color: VAL_COLOR_1
    }];

    const buttons = [];

    for(const bundleData of bundles) {
        const bundle = await getBundle(bundleData.uuid);

        const subName = bundle.subNames ? l(bundle.subNames, interaction) + "\n" : "";
        const slantedDescription = bundle.descriptions ? "*" + l(bundle.descriptions, interaction) + "*\n" : "";
        const embed = {
            title: s(interaction).info.BUNDLE_NAME.f({b: l(bundle.names, interaction)}),
            description: `${subName}${slantedDescription}${emojiString} **${bundle.price || s(interaction).info.FREE}** - ${s(interaction).info.EXPIRES.f({t:bundle.expires})}`,
            color: VAL_COLOR_2,
            thumbnail: {
                url: bundle.icon
            }
        };
        embeds.push(embed);

        if(buttons.length < 5) {
            buttons.push(new MessageButton().setCustomId(`viewbundle/${interaction.user.id}/${bundle.uuid}`).setStyle("PRIMARY").setLabel(l(bundle.names, interaction)).setEmoji("🔎"));
        }
    }

    return {
        embeds: embeds,
        components: [new MessageActionRow().addComponents(...buttons)]
    };
}

export const renderBundle = async (bundle, interaction, emoji, includeExpires=true) => {
    const subName = bundle.subNames ? l(bundle.subNames, interaction) + "\n" : "";
    const slantedDescription = bundle.descriptions ? "*" + l(bundle.descriptions, interaction) + "*\n" : "";
    const strikedBundleBasePrice = bundle.basePrice ? " ~~" + bundle.basePrice + "~~" : "";

    if(!bundle.items) return {embeds: [{
        title: s(interaction).info.BUNDLE_NAME.f({b: l(bundle.names, interaction)}),
        description: `${subName}${slantedDescription}`,
        color: VAL_COLOR_1,
        image: {
            url: bundle.icon
        },
        footer: {
            text: s(interaction).info.NO_BUNDLE_DATA
        }
    }]};

    const emojiString = emojiToString(emoji) || s(interaction).info.PRICE;
    const bundleTitleEmbed = {
        title: s(interaction).info.BUNDLE_NAME.f({b: l(bundle.names, interaction)}),
        description: `${subName}${slantedDescription}${emojiString} **${bundle.price}**${strikedBundleBasePrice}`,
        color: VAL_COLOR_3,
        image: {
            url: bundle.icon
        }
    }

    if(includeExpires && bundle.expires) bundleTitleEmbed.description += ` (${(bundle.expires > Date.now() / 1000 ? 
        s(interaction).info.EXPIRES : s(interaction).info.EXPIRED).f({t: bundle.expires})})`;

    const itemEmbeds = await renderBundleItems(bundle, interaction, emojiString);
    return {
        embeds: [bundleTitleEmbed, ...itemEmbeds]
    }
}

export const renderNightMarket = async (market, interaction, valorantUser, emoji) => {
    if(!market.success) return authFailureMessage(interaction, market, s(interaction).error.AUTH_ERROR_NMARKET);

    if(!market.offers) return {embeds: [basicEmbed(s(interaction).error.NO_NMARKET)]};

    const embeds = [{
        description: s(interaction).info.NMARKET_HEADER.f({u: valorantUser.username, t: market.expires}, interaction),
        color: VAL_COLOR_3
    }];

    const emojiString = emojiToString(emoji) || s(interaction).info.PRICE;

    for(const offer of market.offers) {
        const skin = await getSkin(offer.uuid);

        const embed = await skinEmbed(skin.uuid, skin.price, interaction, emojiString);
        embed.description = `${emojiString} **${offer.nmPrice}**\n${emojiString} ~~${offer.realPrice}~~ (-${offer.percent}%)`;

        embeds.push(embed);
    }

    const components = switchAccountButtons(interaction, "nm", true);
    return {
        embeds, components
    };
}

export const renderBattlepass = async (battlepass, targetlevel, interaction) => {
    if(!battlepass.success) return authFailureMessage(interaction, battlepass, s(interaction).error.AUTH_ERROR_BPASS);

    const user = getUser(interaction.user.id);

    let embeds = []
    if(battlepass.bpdata.progressionLevelReached < 55) {
        embeds.push({
            title: s(interaction).battlepass.CALCULATIONS_TITLE,
            thumbnail: {url: thumbnails[Math.floor(Math.random()*thumbnails.length)]},
            description: `${s(interaction).battlepass.TIER_HEADER.f({u: user.username}, interaction)}\n${createProgressBar(battlepass.xpneeded, battlepass.bpdata.progressionTowardsNextLevel, battlepass.bpdata.progressionLevelReached)}`,
            color: VAL_COLOR_1,
            fields: [
                {
                    "name": s(interaction).battlepass.GENERAL_COL,
                    "value": `${s(interaction).battlepass.TOTAL_ROW}\n${s(interaction).battlepass.LVLUP_ROW}\n${s(interaction).battlepass.TIER50_ROW.f({t: targetlevel})}\n${s(interaction).battlepass.WEEKLY_LEFT_ROW}`,
                    "inline": true
                },
                {
                    "name": s(interaction).battlepass.XP_COL,
                    "value": `\`${battlepass.totalxp}\`\n\`${battlepass.xpneeded}\`\n\`${battlepass.totalxpneeded}\`\n\`${battlepass.weeklyxp}\``,
                    "inline": true
                }
            ],
            footer: {
                text: battlepass.battlepassPurchased ? s(interaction).battlepass.BP_PURCHASED.f({u: user.username}, interaction) : ""
            }
        },
        {
            title: s(interaction).battlepass.GAMES_HEADER,
            color: VAL_COLOR_1,
            fields: [
                {
                    "name": s(interaction).battlepass.GAMEMODE_COL,
                    "value": `${s(interaction).battlepass.SPIKERUSH_ROW}\n${s(interaction).battlepass.NORMAL_ROW}\n`,
                    "inline": true
                },
                {
                    "name": "#",
                    "value": `\`${battlepass.spikerushneeded}\`\n\`${battlepass.normalneeded}\``,
                    "inline": true
                },
                {
                    "name": s(interaction).battlepass.INCL_WEEKLIES_COL,
                    "value": `\`${battlepass.spikerushneededwithweeklies}\`\n\`${battlepass.normalneededwithweeklies}\``,
                    "inline": true
                }
            ],
            footer: {
                text: s(interaction).battlepass.ACT_END.f({d: battlepass.season_days_left})
            }
        },
        {
            title: s(interaction).battlepass.XP_HEADER,
            color: VAL_COLOR_1,
            fields: [
                {
                    "name": s(interaction).battlepass.AVERAGE_COL,
                    "value": `${s(interaction).battlepass.DAILY_XP_ROW}\n${s(interaction).battlepass.WEEKLY_XP_ROW}`,
                    "inline": true
                },
                {
                    "name": s(interaction).battlepass.XP_COL,
                    "value": `\`${battlepass.dailyxpneeded}\`\n\`${battlepass.weeklyxpneeded}\``,
                    "inline": true
                },
                {
                    "name": s(interaction).battlepass.INCL_WEEKLIES_COL,
                    "value": `\`${battlepass.dailyxpneededwithweeklies}\`\n\`${battlepass.weeklyxpneededwithweeklies}\``,
                    "inline": true
                }
            ]
        });
    } else {
        embeds.push({
            description: s(interaction).battlepass.FINISHED,
            color: VAL_COLOR_1,
        })
    }

    const components = switchAccountButtons(interaction, "bp");

    return {embeds, components};
}

const renderBundleItems = async (bundle, interaction, VPemojiString) => {
    if(!bundle.items) return [];

    const priorities = {};
    priorities[itemTypes.SKIN] = 5;
    priorities[itemTypes.BUDDY] = 4;
    priorities[itemTypes.SPRAY] = 3;
    priorities[itemTypes.CARD] = 2;
    priorities[itemTypes.TITLE] = 1;

    const items = bundle.items.sort((a, b) => priorities[b.type] - priorities[a.type]);

    const embeds = [];
    for(const item of items) {
        const embed = await bundleItemEmbed(item, interaction, VPemojiString);

        if(item.amount !== 1) embed.title = `${item.amount}x ${embed.title}`
        if(item.type === itemTypes.SKIN) embed.color = VAL_COLOR_1;
        if(item.basePrice && item.price !== item.basePrice) {
            embed.description = `${VPemojiString} **${item.price || s(interaction).info.FREE}** ~~${item.basePrice}~~`;
            if(item.type === itemTypes.TITLE) embed.description = "`" + item.item.text + "`\n\n" + embed.description
        }

        embeds.push(embed);
    }

    // discord has a limit of 10 embeds (9 if we count the bundle title)
    if(embeds.length > 9) {
        embeds.length = 8;
        embeds.push(basicEmbed(s(interaction).info.MORE_ITEMS.f({n: items.length - 8})));
    }

    return embeds;
}

const bundleItemEmbed = async (item, interaction, VPemojiString) => {
    switch(item.type) {
        case itemTypes.SKIN: return skinEmbed(item.uuid, item.price, interaction, VPemojiString);
        case itemTypes.BUDDY: return buddyEmbed(item.uuid, item.price, interaction.locale, VPemojiString);
        case itemTypes.CARD: return cardEmbed(item.uuid, item.price, interaction.locale, VPemojiString);
        case itemTypes.SPRAY: return sprayEmbed(item.uuid, item.price, interaction.locale, VPemojiString);
        case itemTypes.TITLE: return titleEmbed(item.uuid, item.price, interaction.locale, VPemojiString);
        default: return basicEmbed(s(interaction).error.UNKNOWN_ITEM_TYPE.f({t: item.type}));
    }
}

const skinEmbed = async (uuid, price, interaction, VPemojiString) => {
    const skin = await getSkin(uuid);
    return {
        title: await skinNameAndEmoji(skin, interaction.channel, interaction.locale),
        url: config.linkItemImage ? skin.icon : null,
        description: priceDescription(VPemojiString, price),
        color: VAL_COLOR_2,
        thumbnail: {
            url: skin.icon
        }
    };
}

const collectionEmbed = async (uuid, interaction, price, VPemojiString) => {
    return {
        title: await collectionSkinNameAndEmoji(uuid.displayName, uuid.contentTierUuid, interaction.channel, interaction.locale),
        url: uuid.displayIcon,
        description: priceDescription(VPemojiString, price),
        color: VAL_COLOR_2,
        thumbnail: {
            url: uuid.displayIcon
        }
    }

}

const buddyEmbed = async (uuid, price, locale, VPemojiString) => {
    const buddy = await getBuddy(uuid);
    return {
        title: l(buddy.names, locale),
        url: config.linkItemImage ? buddy.icon : null,
        description: priceDescription(VPemojiString, price),
        color: VAL_COLOR_2,
        thumbnail: {
            url: buddy.icon
        }
    }
}

const cardEmbed = async (uuid, price, locale, VPemojiString) => {
    const card = await getCard(uuid);
    return {
        title: l(card.names, locale),
        url: config.linkItemImage ? card.icons.large : null,
        description: priceDescription(VPemojiString, price),
        color: VAL_COLOR_2,
        thumbnail: {
            url: card.icons.large
        }
    }
}

const sprayEmbed = async (uuid, price, locale, VPemojiString) => {
    const spray = await getSpray(uuid);
    return {
        title: l(spray.names, locale),
        url: config.linkItemImage ? spray.icon : null,
        description: priceDescription(VPemojiString, price),
        color: VAL_COLOR_2,
        thumbnail: {
            url: spray.icon
        }
    }
}

const titleEmbed = async (uuid, price, locale, VPemojiString) => {
    const title = await getTitle(uuid);
    return {
        title: l(title.names, locale),
        description: "`" + title.text + "`\n\n" + (priceDescription(VPemojiString, price) || ""),
        color: VAL_COLOR_2,
    }
}

export const botInfoEmbed = (interaction, client, guildCount, userCount, registeredUserCount, ownerString, status) => {
    const fields = [
        {
            name: s(interaction).info.INFO_SERVERS,
            value: guildCount.toString(),
            inline: true
        },
        {
            name: s(interaction).info.INFO_MEMBERS,
            value: userCount.toString(),
            inline: true
        },
        {
            name: s(interaction).info.INFO_REGISTERED,
            value: registeredUserCount.toString(),
            inline: true
        },
        {
            name: ":dog2:",
            value: s(interaction).info.INFO_WOOF,
            inline: true
        }
    ];
    if(ownerString) fields.push({
        name: s(interaction).info.INFO_OWNER,
        value: ownerString || "Giorgio#0609",
        inline: true
    });
    if(interaction.client.shard) fields.push({
        name: "Running on shard",
        value: interaction.client.shard.ids.join(' ') || "No shard id...?",
        inline: true
    });
    if(status) fields.push({
        name: s(interaction).info.INFO_STATUS,
        value: status || "Up and running!",
        inline: true
    });

    const readyTimestamp = Math.round(client.readyTimestamp / 1000);

    return {
        embeds: [{
            title: s(interaction).info.INFO_HEADER,
            description: s(interaction).info.INFO_RUNNING.f({t1: readyTimestamp, t2: readyTimestamp}),
            color: VAL_COLOR_1,
            fields: fields
        }]
    }
}

export const ownerMessageEmbed = (messageContent, author) => {
    return {
        title: "Message from bot owner:",
        description: messageContent,
        color: VAL_COLOR_3,
        footer: {
            text: "By " + author.username,
            icon_url: author.displayAvatarURL()
        }
    }
}

const priceDescription = (VPemojiString, price) => {
    if(price) return `${VPemojiString} ${price}`;
}

const pageButtons = (pageId, userId, current, max, money) => {
    const leftButton = new MessageButton().setStyle("SECONDARY").setEmoji("◀").setCustomId(`${pageId}/${userId}/${current - 1}/${money}`);
    const rightButton = new MessageButton().setStyle("SECONDARY").setEmoji("▶").setCustomId(`${pageId}/${userId}/${current + 1}/${money}`);

    if(current === 0) leftButton.setEmoji("⏩");
    if(current === max - 1) rightButton.setEmoji("⏪");

    return new MessageActionRow().setComponents(leftButton, rightButton);
}

export const switchAccountButtons = (interaction, customId, oneAccountButton=false) => {
    const json = readUserJson(interaction.user.id);
    if(!json || json.accounts.length === 1 && !oneAccountButton) return [];
    const accountNumbers = [...Array(json.accounts.length).keys()].map(n => n + 1).slice(0, 5);

    const buttons = [];
    for(const number of accountNumbers) {
        const label = s(interaction).info.SWITCH_ACCOUNT_BUTTON.f({n: number.toString()});

        const button = new MessageButton().setStyle("SECONDARY").setLabel(label).setCustomId(`account/${customId}/${interaction.user.id}/${number}`);
        button.setDisabled(number === json.currentAccount);

        buttons.push(button);
    }

    return [new MessageActionRow().setComponents(...buttons)];
}

const alertFieldDescription = async (interaction, channel_id, emojiString, price) => {
    if(channel_id === interaction.channelId) {
        if(price) return `${emojiString} ${price}`;
        if(config.fetchSkinPrices) return s(interaction).info.SKIN_NOT_FOR_SALE;
        return s(interaction).info.SKIN_PRICES_HIDDEN;
    } else {
        const channel = await fetchChannel(channel_id);
        if(channel && !channel.guild) return s(interaction).info.ALERT_IN_DM_CHANNEL;
        return s(interaction).info.ALERT_IN_CHANNEL.f({c: channel_id})
    }
}

export const alertsPageEmbed = async (interaction, alerts, pageIndex, emojiString) => {
    const components = switchAccountButtons(interaction, "alerts");

    if(alerts.length === 0) {
        return {
            embeds: [basicEmbed(s(interaction).error.NO_ALERTS)],
            components: components
        }
    }

    if(alerts.length === 1) {
        const alert = alerts[0];
        const skin = await getSkin(alert.uuid);

        return {
            embeds: [{
                title: s(interaction).info.ONE_ALERT,
                color: VAL_COLOR_1,
                description: `**${await skinNameAndEmoji(skin, interaction.channel, interaction.locale)}**\n${await alertFieldDescription(interaction, alert.channel_id, emojiString, skin.price)}`,
                thumbnail: {
                    url: skin.icon
                }
            }],
            components: [removeAlertActionRow(interaction.user.id, alert.uuid, s(interaction).info.REMOVE_ALERT_BUTTON)].concat(components),
            ephemeral: true
        }
    }

    const maxPages = Math.ceil(alerts.length / config.alertsPerPage);

    if(pageIndex < 0) pageIndex = maxPages - 1;
    if(pageIndex >= maxPages) pageIndex = 0;

    const embed = { // todo switch this to a "one embed per alert" message, kinda like /shop
        title: s(interaction).info.MULTIPLE_ALERTS,
        color: VAL_COLOR_1,
        footer: {
            text: s(interaction).info.REMOVE_ALERTS_FOOTER
        },
        fields: []
    }
    const buttons = [];

    let n = pageIndex * config.alertsPerPage;
    const alertsToRender = alerts.slice(n, n + config.alertsPerPage);
    for(const alert of alertsToRender) {
        const skin = await getSkin(alert.uuid);
        embed.fields.push({
            name: `**${n+1}.** ${await skinNameAndEmoji(skin, interaction.channel, interaction.locale)}`,
            value: await alertFieldDescription(interaction, alert.channel_id, emojiString, skin.price),
            inline: alerts.length > 5
        });
        buttons.push(removeAlertButton(interaction.user.id, alert.uuid, `${n+1}.`));
        n++;
    }

    const actionRows = [];
    for(let i = 0; i < alertsToRender.length; i += 5) {
        const actionRow = new MessageActionRow();
        for(let j = i; j < i + 5 && j < alertsToRender.length; j++) {
            actionRow.addComponents(buttons[j]);
        }
        actionRows.push(actionRow);
    }
    if(maxPages > 1) actionRows.push(pageButtons("changealertspage", interaction.user.id, pageIndex, maxPages));

    if(actionRows.length < 5) actionRows.push(...components);

    return {
        embeds: [embed],
        components: actionRows
    }
}

export const alertTestResponse = async (interaction, success) => {
    if(success) {
        await interaction.followUp({
            embeds: [secondaryEmbed(s(interaction).info.ALERT_TEST_SUCCESSFUL)]
        });
    } else {
        await interaction.followUp({
            embeds: [basicEmbed(s(interaction).error.ALERT_NO_PERMS)]
        });
    }
}

export const allStatsEmbed = async (interaction, stats, pageIndex=0) => {
    const skinCount = Object.keys(stats.items).length;

    if(skinCount === 0) return {
        embeds: [basicEmbed(config.trackStoreStats ? s(interaction).error.EMPTY_STATS : s(interaction).error.STATS_DISABLED)]
    }

    const maxPages = Math.ceil(skinCount / config.statsPerPage);

    if(pageIndex < 0) pageIndex = maxPages - 1;
    if(pageIndex >= maxPages) pageIndex = 0;

    const skinsToDisplay = Object.keys(stats.items).slice(pageIndex * config.statsPerPage, pageIndex * config.statsPerPage + config.statsPerPage);
    const embeds = [basicEmbed(s(interaction).info.STATS_HEADER.f({c: stats.shopsIncluded, p: pageIndex + 1, t: maxPages}))];
    for(const uuid of skinsToDisplay) {
        const skin = await getSkin(uuid);
        const statsForSkin = getStatsFor(uuid);
        embeds.push(await statsForSkinEmbed(skin, statsForSkin, interaction));
    }

    return {
        embeds: embeds,
        components: [pageButtons("changestatspage", interaction.user.id, pageIndex, maxPages)]
    }
}

export const statsForSkinEmbed = async (skin, stats, interaction) => {
    let description;
    if(stats.count === 0) description = s(interaction).error.NO_STATS_FOR_SKIN.f({d: config.statsExpirationDays || '∞'});
    else {
        const percentage = Math.round(stats.count / stats.shopsIncluded * 100 * 100) / 100;
        const crownEmoji = stats.rank[0] === 1 || stats.rank[0] === stats.rank[1] ? ':crown: ' : '';
        description = s(interaction).info.STATS_DESCRIPTION.f({c: crownEmoji, r: stats.rank[0], t: stats.rank[1], p: percentage});
    }

    return {
        title: await skinNameAndEmoji(skin, interaction.channel, interaction.locale),
        description: description,
        color: VAL_COLOR_2,
        thumbnail: {
            url: skin.icon
        }
    }
}

export const accountsListEmbed = (interaction, userJson) => {
    const fields = [];
    for(const [i, account] of Object.entries(userJson.accounts)) {
        let fieldValue;
        if(!account.username) fieldValue = s(interaction).info.NO_USERNAME;
        else fieldValue = account.username;

        fields.push({
            name: `${parseInt(i) + 1}. ${userJson.currentAccount === parseInt(i) + 1 ? s(interaction).info.ACCOUNT_CURRENTLY_SELECTED : ''}`,
            value: fieldValue,
            inline: true
        });
    }

    const hideIgn = getSetting(interaction.user.id, "hideIgn");

    return {
        embeds: [{
            title: s(interaction).info.ACCOUNTS_HEADER,
            fields: fields,
            color: VAL_COLOR_1
        }],
        ephemeral: hideIgn
    }
}

export const settingsEmbed = (userSettings, interaction) => {
    const embed = {
        title: s(interaction).settings.VIEW_HEADER,
        description: s(interaction).settings.VIEW_DESCRIPTION,
        color: VAL_COLOR_1,
        fields: []
    }

    for(const [setting, value] of Object.entries(userSettings)) {
        embed.fields.push({
            name: settingName(setting, interaction),
            value: humanifyValue(value, interaction, true),
            inline: true
        });
    }

    return {
        embeds: [embed]
    }
}

export const basicEmbed = (content) => {
    return {
        description: content,
        color: VAL_COLOR_1
    }
}

export const secondaryEmbed = (content) => {
    return {
        description: content,
        color: VAL_COLOR_2
    }
}

const createProgressBar = (totalxpneeded, currentxp, level) => {
    const length = 14;
    const totalxp = Number(totalxpneeded.replace(',', '')) + Number(currentxp)

    const index = Math.min(Math.round(currentxp / totalxp * length), length);

    const line = '▬';
    const circle = '⬤';

    const bar = line.repeat(Math.max(index, 0)) + circle + line.repeat(Math.max(length - index, 0));

    return level + '┃' + bar + '┃' + (Number(level) + 1);
}
