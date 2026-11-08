/*! 答案词库 + 合法猜测词库（全小写 5 字母常见英文单词） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WordList = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ANSWERS = (
    'about above abuse actor acute admit adopt adult after again agent agree ahead alarm album alert alike alive ' +
    'allow alone along alter among anger angle angry ankle apart apple apply arena argue arise armor arrow aside ' +
    'asset audio audit avoid awake award aware badly baker basic basin batch beach begin being below bench birth ' +
    'black blade blame blank blast blend blind block blood board boost booth bound brain brand brass brave bread ' +
    'break breed brick bride brief bring broad brown brush build built bunch burst cabin cable camel candy canal ' +
    'cargo carry carve catch cause chain chair chalk charm chart chase cheap check chess chest chief child chill ' +
    'china choir chose civic civil claim class clean clear clerk click cliff climb clock close cloth cloud coach ' +
    'coast color coral couch cough could count court cover crack craft crash crawl cream creek crest crime crisp ' +
    'cross crowd crown crude crush curve cycle daily dance dated dealt death debut decay delay delta dense depth ' +
    'diary dirty ditch dizzy dodge doing donor doubt dozen draft drain drama drank drawn dread dream dress dried ' +
    'drift drill drink drive drove drown dryer dusty eagle early earth eight elbow elder elect elite empty enemy ' +
    'enjoy enter entry equal error essay event every exact exist extra fable faced faint fairy faith false fancy ' +
    'fatal fault favor feast fence ferry fewer fiber field fever fight final first flame flash fleet flesh ' +
    'flint float flock flood floor flour fluid flush focus force forge forth forum found frame fraud fresh ' +
    'front frost fruit funny gauge ghost giant given glade glass gleam globe glory glove glued grace grade grain ' +
    'grand grant grape graph grasp grass grave great greed green greet grief grind groan groom group grove growl ' +
    'grown guard guess guest guide guilt habit hairy handy happy harsh haste hatch haunt heart heavy hedge hello ' +
    'hence hobby honey honor horse hotel house hover human humor hurry ideal image imply index inner input irony ' +
    'issue ivory jeans jelly jewel joint jolly judge juice jumbo knack kneel knife knock known label labor laden ' +
    'lance large laser later laugh layer learn lease least leave legal lemon level lever light limit linen ' +
    'liver lobby local lodge logic loose lorry lover lower loyal lucky lunar lunch lying lyric magic major maker ' +
    'maple march marry match maybe mayor meant medal media mercy merge merit metal meter midst might mimic miner ' +
    'minor minus mirth mixed model moist money month moral motor mount mouse mouth movie muddy music named nasty ' +
    'naval nerve never newly night noble noise north notch novel nurse oasis ocean offer often olive onion opera ' +
    'orbit order organ other otter ought ounce outer owner oxide paint panel paper party pasta patch pause peace ' +
    'pearl pedal penny petal phone photo piano piece pilot pinch pitch pivot pixel pizza place plain plane plant ' +
    'plate plead pluck plumb point polar porch pound power press price pride prime print prior prize probe prone ' +
    'proof proud prove pulse punch pupil purse queen query quest queue quick quiet quilt quota radar radio raise ' +
    'rally ranch range rapid ratio reach react ready realm rebel refer reign relax reply rider ridge rifle right ' +
    'rigid rinse risky rival river roast robin robot rocky rogue roman rough round route royal rugby ruler rural ' +
    'sadly saint salad sauce scale scalp scarf scene scent scope score scout scrap screw seize sense serve seven ' +
    'shade shady shaft shake shall shame shape share shark sharp shave sheep sheet shelf shell shift shine shirt ' +
    'shock shoot shore short shout shown shrug siege sight sigma silly since siren sixth sixty skate skill skirt ' +
    'slang sleep slice slide slope small smart smile smoke snake sneak sniff sober solar solid solve sonic sorry ' +
    'sound south space spare spark speak spear speed spell spend spice spike spill spine spite split spoke spoon ' +
    'sport spray squad stack staff stage stain stair stake stale stamp stand stare start state steak steal steam ' +
    'steel steep steer stern stick still sting stock stole stone stood stool store storm story stove strap straw ' +
    'strip stuck study stuff style sugar suite sunny super surge sushi swamp swarm swear sweat sweep sweet swell ' +
    'swept swift swing sword syrup table taken tally tango taste teach tempo tenth thank theft theme there these ' +
    'thick thief thing think third thorn those three threw throw thumb tidal tiger tight timer tired title ' +
    'toast today token tooth topic torch total touch tough towel tower toxic trace track trade trail train trait ' +
    'trash tread treat trend trial tribe trick tried troop trout truck truly trunk trust truth tulip ' +
    'tumor tuner turbo twice twist ultra uncle under union unite unity until upper upset urban usage usual utter ' +
    'vague valid value valve vapor vault venue verse video vigor villa vinyl viral virus visit vital vivid vocal ' +
    'voice voter wagon waist waste watch water weary wedge weird whale wheat wheel where which while whisk white ' +
    'whole whose width wrist write wrong yacht yeast yield young yours youth zebra'
  ).trim().split(/\s+/);

  // 额外合法猜测词（不在答案池里，但允许玩家输入）
  var EXTRA_GUESSES = (
    'aahed aback abaft abase abate abbey abbot abhor abide abode abyss acorn acrid adage adept adobe adore ' +
    'affix afoot agape agile aglow agony aisle alias align allay alley allot alloy aloft aloof aloud amass amaze ' +
    'amber amble amiss amity ample amply amuse angel anime annoy anode antic anvil aorta aphid apron aptly arbor ' +
    'ardor arise armed aroma arose array arson artsy ascot ashen asked askew aspen atlas atoll atone attic augur ' +
    'aunty avert avian await awful awoke axiom azure bacon badge bagel baggy baled baler balmy banal bandy banjo ' +
    'barge baron basil baste bathe baton bayou beady beget begun beige belch belie belly berry berth beset bevel ' +
    'bicep bidet bilge birch bison blimp bloke blurb blurt bloat boggy bogus bolst boner ' +
    'boozy borax bosom botch bough boule bowed bowel boxer braid brake brash brats brawn briar bribe brine brink ' +
    'brisk broil broke brook broom broth brunt buddy budge buggy bugle bulge bulky bully bumpy bunny buoys burly ' +
    'burnt buxom byway cacao cache cacti caddy cadet cagey caked calyx cameo candy caped caper capon ' +
    'carat cared caret cargo carol cater catty caulk cavil cease cedar cello chafe chaff chant chaos chard charr ' +
    'chasm cheep cheer chert chick chide chile chime chirp chock choke chomp chord chore chose chuck chump chunk ' +
    'churn chute cider cinch circa cited civic clack claim clamp clang clank clash clasp cleat clefs cleft clerk ' +
    'clerk clime cling clink cloak clone clout clove clown cluck clued clump clung coals cobra cocoa colon ' +
    'comet comfy comic comma conch condo conic coped copse coral cider'
  ).trim().split(/\s+/).filter(Boolean);

  var ALL_GUESSES = Array.from(new Set(ANSWERS.concat(EXTRA_GUESSES))).sort();

  return {
    ANSWERS: ANSWERS,
    EXTRA_GUESSES: EXTRA_GUESSES,
    ALL_GUESSES: ALL_GUESSES,
    SET: new Set(ALL_GUESSES)
  };
});
