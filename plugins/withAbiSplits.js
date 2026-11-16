/**
 * Build one APK per processor type instead of one APK carrying all of them. A phone only ever
 * loads its own native libraries, so this cuts the download to roughly a third.
 * The in-app updater picks the matching APK from each release.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const SPLITS = `
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86_64"
            universalApk false
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('universalApk false')) return cfg;
    const androidBlock = /\nandroid\s*\{/;
    if (!androidBlock.test(gradle)) throw new Error('withAbiSplits: could not find the android { } block.');
    cfg.modResults.contents = gradle.replace(androidBlock, (match) => `${match}${SPLITS}`);
    return cfg;
  });
};
