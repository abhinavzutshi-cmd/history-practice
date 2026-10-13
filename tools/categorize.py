"""Keyword-based tagging of questions into broad categories.

The source packets carry no subject labels, so each question is scored against
keyword lists; it gets its best-scoring category plus any others that score close.
"""
import re

CATEGORIES = [
    {"id": "us", "name": "U.S. History"},
    {"id": "europe", "name": "European History"},
    {"id": "ancient", "name": "Ancient & Classical World"},
    {"id": "asia", "name": "Asia & Oceania"},
    {"id": "mena", "name": "Middle East & Africa"},
    {"id": "americas", "name": "Latin America & Canada"},
    {"id": "arts", "name": "Arts, Literature & Music"},
    {"id": "religion", "name": "Religion, Mythology & Philosophy"},
    {"id": "science", "name": "Science, Technology & Exploration"},
    {"id": "geo", "name": "Geography"},
    {"id": "pop", "name": "Sports, Pop Culture & Current Events"},
    {"id": "misc", "name": "Other / Uncategorized"},
]

KW = {
    "us": """United States|U\\.S\\.|American Revolution|Civil War|Confederate|Confederacy|Union army|Congress|Senate|senator|Supreme Court|
        President|presidential|Washington|Jefferson|Lincoln|Roosevelt|Jackson|Hamilton|Madison|Monroe|Adams|Kennedy|Nixon|Reagan|Truman|
        Eisenhower|Wilson|Grant|Lee|Sherman|Johnson|Carter|Clinton|Obama|Bush|Trump|Biden|Coolidge|Hoover|Harding|Taft|McKinley|Polk|Tyler|
        Van Buren|Fillmore|Pierce|Buchanan|Hayes|Garfield|Arthur|Cleveland|Harrison|Whig|Republican Party|Democratic Party|New Deal|Reconstruction|
        Gettysburg|Yorktown|Saratoga|Lexington|Boston|New York|Philadelphia|Chicago|Virginia|Massachusetts|California|Texas|Ohio|
        Pennsylvania|Georgia|Carolina|Alabama|Mississippi|Louisiana|Kentucky|Tennessee|Illinois|Michigan|Missouri|Kansas|Nebraska|
        Oklahoma|Arizona|Nevada|Oregon|Colorado|Utah|Montana|Wyoming|Idaho|Iowa|Minnesota|Wisconsin|Indiana|Maryland|Delaware|
        Connecticut|Vermont|New Hampshire|Maine|Florida|Arkansas|Hawaii|Alaska|Manhattan|Brooklyn|Harlem|Los Angeles|San Francisco|
        Seattle|Detroit|Pittsburgh|Abolition|abolitionist|slavery|Underground Railroad|civil rights|Martin Luther King|Rosa Parks|
        Malcolm X|NAACP|Prohibition|Constitution|Bill of Rights|amendment|Declaration of Independence|Founding Fathers|Puritans?|
        Pilgrims|Plymouth|Jamestown|Thirteen Colonies|Native American|Cherokee|Sioux|Lakota|Apache|Shawnee|Iroquois|Navajo|Comanche|
        Trail of Tears|Manifest Destiny|Louisiana Purchase|Mexican-American War|Spanish-American War|Pearl Harbor|Vietnam War|
        Watergate|Cold War|Federalist|Gilded Age|Revolutionary War|Continental Army|Continental Congress|West Point|Ticonderoga|Progressive Era|Great Depression|FBI|CIA|NASA|Ku Klux Klan|Tammany|Wall Street|
        American""",
    "europe": """Europe|European|England|English|Britain|British|UK|United Kingdom|Scotland|Scottish|Ireland|Irish|Wales|Welsh|France|French|
        Paris|Napoleon|Bourbon|Louis|Versailles|Germany|German|Prussia|Prussian|Berlin|Bismarck|Hitler|Nazi|Weimar|Austria|Austrian|Habsburg|
        Vienna|Hungary|Hungarian|Italy|Italian|Venice|Florence|Medici|Milan|Naples|Sicily|Spain|Spanish|Madrid|Castile|
        Aragon|Portugal|Portuguese|Lisbon|Netherlands|Dutch|Holland|Belgium|Flanders|Switzerland|Swiss|Sweden|Swedish|Norway|Norwegian|
        Denmark|Danish|Finland|Viking|Iceland|Poland|Polish|Lithuania|Russia|Russian|Soviet|USSR|Moscow|Tsar|Czar|Romanov|Lenin|Stalin|
        Ukraine|Ukrainian|Kyiv|Kiev|Czech|Slovak|Serbia|Croatia|Bosnia|Yugoslavia|Balkan|Bulgaria|Romania|Albania|Greece(?=.*(19|20)\\d\\d)|
        Tudor|Stuart|Plantagenet|Windsor|Hanover|Henry the|Elizabeth|Victoria|Queen Victoria|Churchill|Parliament|Prime Minister|
        Westminster|London|Oxford|Cambridge|Edinburgh|Dublin|Salisbury|Druids?|Hundred Years|Thirty Years|World War|Holocaust|Crusade|Charlemagne|
        Holy Roman|Carolingian|Merovingian|Frank|Normandy|Norman|feudal|medieval|Middle Ages|Renaissance|Reformation|Martin Luther|
        Calvin|Enlightenment|Waterloo|Trafalgar|Verdun|Somme|Stalingrad|Battle of Britain|D-Day|NATO|European Union|Brexit|Magna Carta|
        Pope|papal|Vatican|Inquisition|Bolshevik|Kaiser|Wilhelm|Frederick the Great|Peter the Great|Catherine the Great|Ottoman(?=.*Europe)""",
    "ancient": """ancient|Rome|Roman|Caesar|Augustus|Julius|Nero|Caligula|Trajan|Hadrian|Constantine|Diocletian|Marcus Aurelius|Cicero|
        Senate of Rome|consul|Carthage|Carthaginian|Hannibal|Punic|Sparta|Spartan|Athens|Athenian|Pericles|Peloponnesian|Persian Wars|
        Thermopylae|Marathon|Alexander the Great|Macedon|Macedonian|Philip the Second|Hellenistic|Ptolemy|Ptolemaic|Seleucid|Cleopatra|
        pharaoh|Egypt(?!ian Revolution)|pyramid|Giza|Tutankhamun|Ramses|Mesopotamia|Sumer|Sumerian|Akkad|Babylon|Babylonian|Hammurabi|
        Assyria|Assyrian|Hittite|Phoenicia|Phoenician|Achaemenid|Cyrus|Darius|Xerxes|Parthian|Sasanian|Etruscan|Minoan|Mycenaean|
        Troy|Trojan|Homer|Iliad|Odyssey|Socrates|Plato|Aristotle|Herodotus|Thucydides|cuneiform|hieroglyph|Bronze Age|Iron Age|
        Neolithic|Paleolithic|Stonehenge|prehistoric|Stone Age|Indus Valley|Harappa|Mohenjo|Olmec|Gaul|Gallic|Celts?|Byzantine|Justinian|legion|gladiator|
        Pompeii|Vesuvius|B\\.C\\.|BCE|Republic of Rome|Roman Republic|Roman Empire|Augustine""",
    "asia": """Asia|Asian|China|Chinese|Beijing|Peking|Shanghai|Ming|Qing|Han dynasty|Tang|Song dynasty|Yuan|Zhou|Shang|Qin|Mao|Zedong|
        Chiang Kai-shek|Sun Yat-sen|Confucius|Confucian|Taiwan|Hong Kong|Tibet|Mongol|Mongolia|Genghis|Kublai|Japan|Japanese|Tokyo|Kyoto|
        Edo|Meiji|Tokugawa|shogun|samurai|Shinto|Korea|Korean|Seoul|Joseon|Goryeo|Pyongyang|Kim Jong|India|Indian(?! Ocean)|Delhi|Mughal|
        Akbar|Gandhi|Nehru|Raj|Maurya|Ashoka|Gupta|Chola|Mumbai|Bombay|Calcutta|Kolkata|Bengal|Punjab|Pakistan|Bangladesh|Sri Lanka|Ceylon|
        Nepal|Afghanistan|Vietnam|Vietnamese|Hanoi|Saigon|Ho Chi Minh|Cambodia|Khmer|Angkor|Laos|Thailand|Siam|Burma|Myanmar|Malaysia|
        Malaya|Singapore|Indonesia|Java|Sumatra|Bali|Philippines|Filipino|Manila|Australia|Australian|New Zealand|Maori|Aboriginal|
        Pacific Islands|Polynesia|Fiji|Samoa|Tonga|Kazakhstan|Uzbekistan|Silk Road|Timur|Tamerlane|Sikh|Hindu Kush""",
    "mena": """Africa|African|Egypt|Egyptian|Cairo|Nile|Sudan|Ethiopia|Ethiopian|Abyssinia|Aksum|Kenya|Nigeria|Ghana|Mali|Mansa Musa|Songhai|
        Timbuktu|Zulu|South Africa|apartheid|Mandela|Congo|Zaire|Rwanda|Uganda|Tanzania|Zanzibar|Zimbabwe|Rhodesia|Mozambique|Angola|
        Senegal|Liberia|Sierra Leone|Morocco|Algeria|Tunisia|Libya|Gaddafi|Qaddafi|Sahara|Swahili|Boer|Biafra|Somalia|Madagascar|
        Middle East|Israel|Israeli|Jerusalem|Palestine|Palestinian|Arab|Arabia|Saudi|Mecca|Medina|Iraq|Baghdad|Iran|Iranian|Persia|
        Persian|Tehran|Shah|Ayatollah|Khomeini|Syria|Damascus|Lebanon|Beirut|Jordan|Kuwait|Yemen|Oman|Qatar|Emirates|Dubai|Turkey|
        Turkish|Ottoman|Istanbul|Constantinople|Atatürk|Ataturk|Sultan|caliph|Caliphate|Umayyad|Abbasid|Fatimid|Mamluk|Saladin|Kurd|
        Zionism|Zionist|Suez|Nasser|Sadat|Hezbollah|Hamas|ISIS""",
    "americas": """Latin America|South America|Central America|Mexico|Mexican|Aztec|Tenochtitlan|Maya|Mayan|Inca|Cuzco|Cusco|Peru|Peruvian|
        Brazil|Brazilian|Argentina|Argentine|Buenos Aires|Chile|Chilean|Colombia|Venezuela|Bolívar|Bolivar|Bolivia|Ecuador|Paraguay|
        Uruguay|Cuba|Cuban|Castro|Havana|Haiti|Haitian|Dominican|Puerto Rico|Jamaica|Caribbean|Panama|Nicaragua|Guatemala|Honduras|
        El Salvador|Costa Rica|conquistador|Cortés|Cortes|Pizarro|Moctezuma|Montezuma|Perón|Peron|Pinochet|Sandinista|Zapata|
        Pancho Villa|Juárez|Juarez|Santa Anna|San Martín|Canada|Canadian|Quebec|Ontario|Montreal|Toronto|Ottawa|Manitoba|Alberta|
        British Columbia|Nova Scotia|Newfoundland|Acadia|Hudson's Bay|Inuit|First Nations|Mohawk""",
    "arts": """painting|painter|painted|sculpt|sculptor|sculpture|artist|portrait|novel|novelist|poem|poet|poetry|author|wrote|book|play(wright)?|
        Shakespeare|opera|composer|composed|symphony|concerto|sonata|ballet|music|musician|song|album|band|jazz|blues|rock and roll|
        film|movie|director|Hollywood|theater|theatre|architect|architecture|cathedral|museum|Impressionis|Baroque|Romantic|Cubis|
        Surreal|Renaissance art|fresco|mural|literature|literary|fiction|Mozart|Beethoven|Bach|Picasso|Monet|Van Gogh|Rembrandt|
        Michelangelo|da Vinci|Dickens|Tolstoy|Hemingway|Twain|novella|trilogy|series of books|illustrat|photograph|dance|
        Harlem Renaissance|Broadway|Nobel Prize in Literature|Pulitzer""",
    "religion": """religion|religious|god|goddess|deity|deities|myth|mythology|mythological|legend|Zeus|Odin|Thor|Apollo|Athena|Hera|
        Jupiter|Osiris|Isis|Ra |Christian|Christianity|Jesus|Christ|Bible|biblical|Old Testament|New Testament|Gospel|apostle|saint|
        St\\.|church|Catholic|Protestant|Orthodox|Anglican|Methodist|Baptist|Quaker|Mormon|Lutheran|Jesuit|monk|monastery|abbey|
        bishop|archbishop|Pope|papacy|Islam|Islamic|Muslim|Muhammad|Quran|Qur'an|Sunni|Shia|Shi'a|Sufi|imam|mosque|Judaism|Jewish|
        Jews|Torah|Talmud|rabbi|synagogue|Moses|Abraham|Hindu|Hinduism|Vishnu|Shiva|Krishna|Buddha|Buddhism|Buddhist|Zen|Dalai Lama|
        Jain|Sikh|Zoroast|Tao|Daoism|Taoism|Confucian|philosopher|philosophy|Plato|Aristotle|Socrates|Kant|Hegel|Nietzsche|Descartes|
        Locke|Hobbes|Rousseau|Voltaire|Marx|existential|theolog|heresy|heretic|prophet|scripture|temple|pilgrimage""",
    "science": """scien|scientist|physics|physicist|chemist|chemistry|biolog|astronom|mathematic|theorem|equation|invent|inventor|invention|
        patent|discover|experiment|telescope|microscope|vaccine|disease|epidemic|pandemic|plague|smallpox|polio|medicine|medical|
        physician|surgeon|surgery|penicillin|DNA|gene|evolution|Darwin|Newton|Einstein|Galileo|Copernicus|Kepler|Edison|Tesla|Curie|
        atom|atomic|nuclear|radio|telegraph|telephone|computer|internet|engine|steam engine|railroad|railway|airplane|aircraft|
        Wright brothers|rocket|satellite|space|astronaut|cosmonaut|NASA|Apollo program|moon landing|planet|Mars|Venus|Mercury|Saturn|Jupiter's|solar system|rover|comet|asteroid|orbit|explorer|expedition|voyage|
        circumnavigat|Columbus|Magellan|Vasco da Gama|Cook|Antarctic|Arctic|North Pole|South Pole|Everest|technology|electricity|
        Nobel Prize in (Physics|Chemistry|Medicine)|element|periodic|geolog|volcano|earthquake""",
    "geo": """river|mountain|lake|island|peninsula|strait|canal|ocean|sea\\b|gulf|bay\\b|desert|plateau|capital city|capital of|city of|
        border|borders|landlocked|province|region|archipelago|isthmus|delta|valley|glacier|coast|harbor|harbour|port city|
        largest city|most populous|population|geograph|continent|Himalaya|Andes|Alps|Rockies|Amazon|Mississippi River|Danube|Rhine|
        Yangtze|Ganges|Mekong|Sahara|Gobi|Great Lakes|tributary|waterfall|Falls""",
    "pop": """sport|sports|baseball|football|basketball|hockey|soccer|Olympic|Olympics|World Cup|Super Bowl|World Series|NFL|NBA|MLB|NHL|
        FIFA|tennis|golf|boxing|boxer|athlete|team|championship|MVP|Hall of Fame|coach|television|TV show|sitcom|celebrity|video game|
        Disney|Marvel|comic|cartoon|YouTube|Twitter|Facebook|social media|streaming|Netflix|Apple|Google|Amazon(?! River| rainforest)|
        Microsoft|Tesla Inc|brand|company|corporation|Coca-Cola|McDonald's|toy|board game|2019|2020|2021|2022|2023|2024|2025|2026|
        COVID|pop star|singer|rapper|Grammy|Oscar|Academy Award|Emmy""",
}

PATTERNS = {k: re.compile(r"\b(?:" + re.sub(r"\s+", "", v) + r")", re.I) for k, v in KW.items()}

# Thematic categories tend to rack up hits on common words; damp them slightly.
WEIGHT = {"geo": 0.6, "pop": 0.8, "arts": 0.9, "science": 0.9, "religion": 0.9}


def scores(text):
    return {k: len(p.findall(text)) * WEIGHT.get(k, 1.0) for k, p in PATTERNS.items()}


def giveaway(q):
    """The final clue (after 'for ten points' / last sentence) names the subject most plainly."""
    m = re.search(r"for (ten|10|the) points?,?(.*)$", q, re.I)
    if m:
        return m.group(2)
    parts = re.split(r"(?<=[.?!])\s+", q.strip())
    return parts[-1] if parts else q


def categorize(text, answer="", final=""):
    sc = scores(text)
    for extra, w in ((final, 2.0), (answer, 2.5)):
        if extra:
            for k, v in scores(extra).items():
                sc[k] += v * w
    ranked = sorted(sc.items(), key=lambda kv: -kv[1])
    top_k, top = ranked[0]
    if top <= 0:
        return ["misc"]
    out = [top_k]
    for k, v in ranked[1:]:
        if v >= max(2.0, 0.6 * top):
            out.append(k)
    return out[:3]
