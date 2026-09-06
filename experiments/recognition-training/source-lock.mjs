// @ts-check

/** The exact public revision reviewed before this experiment. */
export const LILA_REVISION = '2e48c25007bc3344411811a24cd6cab666c67cbf';
export const LILA_COPYING_SHA256 =
  'd5b0b45dd3dc8430e5b826ba788e62137eae938319a16d4ed5c9e4d5b2899da9';
export const PIECE_CODES = /** @type {const} */ ([
  'wK',
  'wQ',
  'wR',
  'wB',
  'wN',
  'wP',
  'bK',
  'bQ',
  'bR',
  'bB',
  'bN',
  'bP',
]);

/**
 * A source hash is SHA-256 over sorted `filename + " " + sha256(file) + "\\n"`
 * lines. It detects a changed, missing, added, or substituted glyph before
 * generation without putting redistributable source artwork in this repository.
 */
export const SOURCE_FAMILIES = Object.freeze({
  chessnut: {
    split: 'train',
    authorFamily: 'Alexis Luengas',
    license: 'Apache-2.0',
    lilaPath: 'public/piece/chessnut',
    sourceSha256: '569456b1ccd41a5f5787101ca05f622e65e1435485d490d1bf5c357c90cc02fb',
    fileSha256: Object.freeze({
      'bB.svg': '1660d01f51eea3bd4a7677920b8f261481e5d5758b372ce062a508c8a1026175',
      'bK.svg': 'b0fd61530fb2ea35f10ff59456b18b845a306110d9ba3220ce7d0b7f68167eab',
      'bN.svg': '078ef9a73782e35deea380a11e9918ee1bc38f1302c384bab9354bbe89a9e338',
      'bP.svg': 'b3a9c2a3d949c74a5dbe0882631086fdcf02309ed8ba941718b91d550ca35c8e',
      'bQ.svg': 'c3973c41730ae03038501329b84d061040fc8c72b0ce24940ada07a3e8379c18',
      'bR.svg': 'c40f0c10b21635703b050d2996d4cbfe3b443e2573304ee91ed29fd7be61caa1',
      'wB.svg': 'fdac5e5848b67aed513416d347c6b6479dbf86a2be3f6fdd44555d724ae1b7a7',
      'wK.svg': '31bffcebab6aedc808680824571641625ecd263804bd6a6963be78d5962a7935',
      'wN.svg': '73a4860e4f73034ca1579e952240e8cce57affec677e87b7e1dd8cf9c3dbcdd1',
      'wP.svg': '423f9a04ff6a18ed129d90269e15b7a0d5390ac775e8d3468d09feb33f92ea0e',
      'wQ.svg': '21d84a10b2d0f7ebeff93bc452a12e66dd6928b35d7db21d20b59fcc520584fb',
      'wR.svg': '0bb5bc1be4100f5f3158cc568df44ae16b5f9110a342c4186aba007729a65052',
    }),
  },
  fantasy: {
    split: 'train',
    authorFamily: 'Maurizio Monge',
    license: 'MIT',
    lilaPath: 'public/piece/fantasy',
    sourceSha256: '4053a01a604fa643a35a7a9fb5d97e4f917e624ca5020c26f40b0841b7c47be7',
    fileSha256: Object.freeze({
      'bB.svg': '39788f0768af3955015b67e2fb9a8cac1412f12a173cfe055afdaa06b652cc8b',
      'bK.svg': '63ac211b7584a80739ac0ce4788f5b6421dfc854216d4950cae7015947d5e3d0',
      'bN.svg': '6068614e192901fa8b65ce78d5b604bddb901688278f65569ebf9ff86ef9fc93',
      'bP.svg': 'cb86603c9036bc5d64561fa909df80e27888e1716f73c5ebe61035e3ecb3a266',
      'bQ.svg': '89dfc276f1336c44b5fc260803cad7beb2bc3e5e0faea3395c0118312ab53052',
      'bR.svg': 'e2ffb1b77780e2a744c4f9b00d4a1feff7da52e39bad0d357fc0b695856be9f8',
      'wB.svg': '793d3de1262d36f1dcf2d298c3924fca6976cd2337583f41480dadcfb2afc18e',
      'wK.svg': 'b5f2e7efce1f40a6733c6e22b7016e8699ddb89807a9e9539f837e4c4b7b4d1d',
      'wN.svg': '84b5e7701b6d8fca62b610380620042e9737b8276cf17f829a64f6c8645ea38d',
      'wP.svg': 'ed5080fc4cd1d5b14d6acc77afabcdd99c225f3ce5c082015490394ea0676831',
      'wQ.svg': 'f97490b5b60a6978a15c40d86b69ce06df36bf3869b2bd82382819a724fd84a4',
      'wR.svg': '957efd4929507a4e3230912cab678baa2c308e6c4714cc094052543438458ab8',
    }),
  },
  spatial: {
    split: 'train',
    authorFamily: 'Maurizio Monge',
    license: 'MIT',
    lilaPath: 'public/piece/spatial',
    sourceSha256: '85b182d35bc6d871337c43e8746e14860d24a16cd221527038423ae7e74e0478',
    fileSha256: Object.freeze({
      'bB.svg': 'e38bd48cd497da74e9b3d9c3ae69cf7c7a0dc9ede73d735ba3b957a7dfbc47f8',
      'bK.svg': 'bf91ce1bead0bc273621ed8ebb112542d94b34254dac84ffdd623b81e44205ef',
      'bN.svg': '803bf14ffa22c6584a99ab0d2e3fb91879bfdf0ceee0f938c1c43e05f3538399',
      'bP.svg': '30db84b20f2d50c10bc7d03536be524d81e5d3bdc2a36c0ab6951ece5f3b6788',
      'bQ.svg': '517f98be7cd7b6a71d5aadebbdfe868a244b491e5101fa79fbd861d2cc5ce4de',
      'bR.svg': '447b8c7e36dc2533c30721ab7766a48c70981aa89c55ffbcb5df62f91cab61f4',
      'wB.svg': 'f20f4a5e0d0913a2bf68b30706c77b3f4d234e9dbe858dc4a033da2a6a32163d',
      'wK.svg': '76d3d9903c3e38f277dff4410c08e78ab71aec83724583d9e893c6a7d8330675',
      'wN.svg': '44e7658217f2f2f0221b8c75dc19740678e4a53827f142fae663e5f85f1d3604',
      'wP.svg': 'cb9f97da483350296ce4df3bbe053d86c3ef9a588a9452b9833e1f3a56c10c5f',
      'wQ.svg': 'c5013e96e48b05e6617da93525d0f3d03779d60af76b93608d197f4c272043a9',
      'wR.svg': 'a5540a32c24da5c86e97eef8881a6d6dc0b71c1a022f017df2ad76adbd87cb7d',
    }),
  },
  celtic: {
    split: 'train',
    authorFamily: 'Maurizio Monge',
    license: 'MIT',
    lilaPath: 'public/piece/celtic',
    sourceSha256: '3efc5aebd5a21c9a2c7a95f75b61016720c86e57ef842dbb4000e047b9affe12',
    fileSha256: Object.freeze({
      'bB.svg': 'ff64c9ed5215a204a30fe2d865fdcada4cc99612572af64f5f86b250891badfa',
      'bK.svg': '5bf1d8951c2591ee1b5136288f93adb0c391b8d5f3d546541b1f4e85605e767b',
      'bN.svg': 'b8478a90e1b930e0e6edc50d5e28d202112d5008ef9716fdd487abc8050f6758',
      'bP.svg': 'fdfb9bc177cea6e8e3da18b2f9424190639a73f8ab4fa769f0db5bc27c0e8a21',
      'bQ.svg': '867d05d3d7c06de0fa3ce50fa1aa3e7587e9b1e5672db540477187508949b889',
      'bR.svg': 'd2c551bf7bab9e636f6304dcc6eff372fe397377a5deedd14cd724205754ff09',
      'wB.svg': 'cb8c52171ae7698c84b21c519e1cd565475157a9132e451f91b28d6ac5da68e8',
      'wK.svg': 'bc4625aa000be804de4782cf4a6eae5daf4dccd25f74673052805d04557af3d4',
      'wN.svg': '426c1e7f5d7377b398774a4133b1fb4e9b0dfcacd30347321f6ecf7eae4aaf64',
      'wP.svg': '6c09cdd783a12cd995f702ad2f7bd0ce2b61a5d6fe6296d05b1c0cb8172d71fc',
      'wQ.svg': '677aa5b7f5d876595d4b7edbf7977ed9d8131dea96ff5ff2cf92c0915a0a7eb8',
      'wR.svg': 'd431e99d9e14932393ee41cd0ca83132aa15f684991a905d160a2dd437063945',
    }),
  },
  firi: {
    split: 'dev',
    authorFamily: 'James Faure',
    license: 'CC-BY-4.0',
    lilaPath: 'public/piece/firi',
    sourceSha256: '814b6e2cd6e0cfaf91d85dfa5788712331f0a5e020e14a67d76e2a7e3b7d1c53',
    fileSha256: Object.freeze({
      'bB.svg': 'c380cb80afc4a91f9a6827b4cad04848f9f171976ae4493660bb280d2279c7b3',
      'bK.svg': '6b34a83659387767723e36da10223c9b927839e0944456b69312b0887c5ea0bd',
      'bN.svg': '1d6132f68578f346b85e5096d3cd57dc97a58349cebd6c5884c4c73c412ae6d6',
      'bP.svg': 'dbe57bae29c3566661cdb6a62e828681a017e7bbea3da3570c00dbb131c34ee8',
      'bQ.svg': '2d8beeb54e5357876b1e5621b468dbb49bcf3a5e84f656f3938c2b53027620f6',
      'bR.svg': '54a67fef52cccbbb7af52f28ec930255bf2203ff01adb7e3363605f421e99dd2',
      'wB.svg': '294ec8d0a3afa6a279f3a7e23515f13f318fa553e395a0552c4559a1fc831e85',
      'wK.svg': '6418419479bf0e3a60f01a1a925ec09b0e9783c305da6d22ec6657498ea554b1',
      'wN.svg': '16d0d2be7dae0e0cafb9b109cffb62e6e657c2a646edf5194ad032a3f3c74702',
      'wP.svg': '1f61376106f1b8d80ddb8b6c0bcc476d49c625845adc57ba660c86649dabe11d',
      'wQ.svg': '0d60559a476f0b0882a4bacbeea861b74ca96abae7df1481379c088a8644187f',
      'wR.svg': 'fe3e322e86db6dbd1c3677dd7763333f011afc0323272de4e9598996752cdc9e',
    }),
  },
  rhosgfx: {
    split: 'test',
    authorFamily: 'RhosGFX',
    license: 'CC0-1.0',
    lilaPath: 'public/piece/rhosgfx',
    sourceSha256: 'f9af3057d37f6e2a8639afa548b03bb63881c8279cc81955987f3702fb8b701f',
    fileSha256: Object.freeze({
      'bB.svg': '2d93c7f0dd47f4bf5f05f8eae7a6fb47fb68d9578245f36b20e14a71d10b635a',
      'bK.svg': '74acb4e12ab8f6e19da483fae136c3b0618336ed73f96feb22ae0adb445f39b3',
      'bN.svg': '07420189a69e58a46f4d8df18b95608c6d1c2051e105c2e3cf80e1c3ea45a08d',
      'bP.svg': 'fe06f8e42ca883c2a79535514670862f37228980da7de5028213a6b7b388044b',
      'bQ.svg': '416b21a850bff5676c2a052341419783feba9569163803589e4fb4c07d4e19e1',
      'bR.svg': '9a43817e05067a2fc35dc760faec21732ec66c8a72d262374dc031fadb40eca7',
      'wB.svg': 'e9c00b057672ec693e2da7808873085aee2f6f7c61cc8f68386d01a7e94d6859',
      'wK.svg': '5a5bb397e8f8b08fee64a98a83a07dd287eb1557ffef31b22453ea80ed03d500',
      'wN.svg': '38adc3f8293e186386b1be2a7e489648027f68866c22e64fdaa39f2582047ab2',
      'wP.svg': 'ec9cc7778fe148cd740586964ee3f789ef22dcda77f3ce5ee3ddf47f76c210b8',
      'wQ.svg': 'e937921417c5a5d3fd4881183821594ed5afe0892cb492fe74f4f33bc81bb37f',
      'wR.svg': '26963e5f4fc8d324be998c654d9822644100702e48e49ddac74596d7bc0fffa2',
    }),
  },
});

export const CLASS_ORDER = '1KQRBNPkqrbnp';
export const CLASS_BY_FEN = Object.freeze(
  Object.fromEntries(Array.from(CLASS_ORDER).map((piece, index) => [piece, index])),
);
export const DATASET_SEED = 0x38c0ffee;
export const FULL_SPLIT_SIZES = Object.freeze({ train: 4096, dev: 256, test: 256 });
export const PILOT_SPLIT_SIZES = Object.freeze({ train: 64, dev: 32, test: 0 });
