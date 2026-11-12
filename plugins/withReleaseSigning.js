/**
 * Signs release builds with the suite's upload key when it is provided through environment
 * variables (CI), and falls back to the debug key otherwise so local builds still work.
 * A stable signing key is what lets Android install a new APK over the old one.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_BLOCK = `
    signingConfigs {
        release {
            if (System.getenv("RELEASE_KEYSTORE_PATH")) {
                storeFile file(System.getenv("RELEASE_KEYSTORE_PATH"))
                storePassword System.getenv("RELEASE_KEYSTORE_PASSWORD")
                keyAlias System.getenv("RELEASE_KEY_ALIAS")
                keyPassword System.getenv("RELEASE_KEY_PASSWORD")
                storeType "PKCS12"
            }
        }
    }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('RELEASE_KEYSTORE_PATH')) return cfg;

    const androidBlock = /\nandroid\s*\{/;
    if (!androidBlock.test(gradle)) throw new Error('withReleaseSigning: could not find the android { } block.');
    gradle = gradle.replace(androidBlock, (match) => `${match}${SIGNING_BLOCK}`);

    // Point the release build type at the release key when it is configured.
    const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
    if (!releaseType.test(gradle)) throw new Error('withReleaseSigning: could not find the release signingConfig.');
    gradle = gradle.replace(
      releaseType,
      '$1signingConfig System.getenv("RELEASE_KEYSTORE_PATH") ? signingConfigs.release : signingConfigs.debug',
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
