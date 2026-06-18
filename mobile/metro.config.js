// The Expo app lives inside the larger resumeright repo. Scope Metro's file
// watching to mobile/ only so it never crawls the sibling backend/ and
// frontend/ node_modules — fewer watched files = faster starts and less chance
// of the macOS "EMFILE: too many open files" watcher crash.
//
// NOTE: the real fix for EMFILE is installing Watchman (`brew install watchman`).
// This config reduces the watch footprint but Watchman is still recommended.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [__dirname];

module.exports = config;
