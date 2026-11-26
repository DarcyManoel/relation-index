// The places of a person are kept on the person as places, a list of entries, each is { name, kind, fromYear, toYear, note, links }, name is a text that is not empty, kind is born, lived, died, buried or other, fromYear and toYear are whole years that are only there when they were given, a born, died or buried place is one event, so its year is kept in fromYear and it has no toYear, note is only there when it was written, and links is a list of web addresses, a person with no places has no such property, two entries are the same place when their names are the same without case, accents and extra spaces, so Zürich and ZURICH are one place everywhere
let placeKinds = [`born`, `lived`, `died`, `buried`, `other`]
let placeKindLabels = {
	born : `Born`,
	lived : `Lived`,
	died : `Died`,
	buried : `Buried`,
	other : `Other`
}

// The kinds that are a single event and so have one year, the other kinds are spans with a first and a last year, and the order of placeKinds is also the order of a life, which is the order the island lists the places in
let singleEventPlaceKinds = [`born`, `died`, `buried`]

// The dialog works on a copy of the list, so Cancel throws every change away, the years are kept as the text that was typed, so a half typed year is never lost, and they are only turned into numbers when the dialog is saved
let placesDraft = {
	personId : null,
	entries : [],
	selectedIndex : 0
}

// The place names that the suggestions under the name box offer right now, counted from the top, so a click knows which one it is
let placeSuggestionNames = []

// The places that the search results show right now, counted from the top, so a click on one knows which place it is
let placeSearchMatches = []

// A year is a whole number from 0 to 9999, a year typed as text is understood as well, anything else is no year
function sanitizePlaceYear(value) {
	let year = typeof value == `string` && value.trim() != `` ? Number(value) : value

	return Number.isInteger(year) && year >= 0 && year <= 9999 ? year : null
}

// One place made safe, the answer is null for a place with no name, a kind that does not exist becomes other, and the parts that are not given are left out, the parts are always in the same order so a place that is already safe is never changed
function sanitizePlace(place) {
	let name = typeof place.name == `string` ? place.name.trim().replace(/\s+/g, ` `) : ``

	if(name == ``){
		return null
	}

	let fromYear = sanitizePlaceYear(place.fromYear)
	let toYear = sanitizePlaceYear(place.toYear)

	return {
		name : name,
		kind : placeKinds.includes(place.kind) ? place.kind : `other`,
		...(fromYear == null ? {} : { fromYear : fromYear }),
		...(toYear == null ? {} : { toYear : toYear }),
		...(typeof place.note == `string` && place.note.trim() != `` ? { note : place.note.trim() } : {}),
		links : sanitizeLinks(place)
	}
}

// What a person written into a file by hand or by an older version may hold is made safe, a person with no places left has no places property, this is done when the page starts and when a file is imported
function sanitizePlaces(person) {
	if(person.places === undefined){
		return
	}

	let places = (Array.isArray(person.places) ? person.places : [])
		.filter(isPlainObject)
		.map(sanitizePlace)
		.filter((place) => place)

	if(places.length == 0){
		delete person.places
	} else {
		person.places = places
	}
}

// Every place that is used by anyone, found by its normalised name, each one once, with the name as it was first written and everyone who has it, the people are looked at in the order of their ids so the answer never changes between two calls
function getPlaceIndex() {
	let placeIndex = new Map()

	for(let [personId, person] of Object.entries(persons)){
		for(let place of person.places ?? []){
			let placeKey = normalizeNameText(place.name)

			if(placeKey == ``){
				continue
			}

			if(!placeIndex.has(placeKey)){
				placeIndex.set(placeKey, {
					key : placeKey,
					name : place.name,
					personIds : new Set()
				})
			}

			placeIndex.get(placeKey).personIds.add(Number(personId))
		}
	}

	return placeIndex
}

// The years of a place as they are shown, two different years are a span, one year or two equal years are that year, and no year is an empty text, the separator is what goes between the two years of a span
function getPlaceYearsText(place, separator) {
	let years = singleEventPlaceKinds.includes(place.kind) ? [place.fromYear ?? place.toYear].filter((year) => year != null) : [place.fromYear, place.toYear].filter((year) => year != null)

	if(years.length == 0){
		return ``
	}

	return years.length == 2 && years[0] != years[1] ? `${years[0]}${separator}${years[1]}` : `${years[0]}`
}

// The links of a place are small badges with the host name, a web address opens in a new tab and anything else is shown as typed, clicking a badge must not also open the place
function buildPlaceLinksHtml(links) {
	return links
		.map((link) => isWebAddress(link)
			? `<a class="link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHtml(getLinkLabel(link))}</a>`
			: `<span class="link">${escapeHtml(link)}</span>`)
		.join(``)
}

// The order of a life, born, then lived by the year it started, then died, then buried, then other, a lived place with no start year goes after the ones that have one, and places that are level stay in the order they were entered, the places are sorted here and not in the data, so the position of a place in the data never changes and the keyboard still opens the right entry
function comparePlacesByLifeStage(firstEntry, secondEntry) {
	let kindDifference = placeKinds.indexOf(firstEntry.place.kind) - placeKinds.indexOf(secondEntry.place.kind)

	if(kindDifference != 0){
		return kindDifference
	}

	if(firstEntry.place.kind == `lived`){
		return (firstEntry.place.fromYear ?? 10000) - (secondEntry.place.fromYear ?? 10000) || firstEntry.storedIndex - secondEntry.storedIndex
	}

	return firstEntry.storedIndex - secondEntry.storedIndex
}

// One place of the island, the name, the kind, the years when there are any and the links when there are any, clicking the row opens the people who are connected to the place, the position in the list is kept on the row so the keyboard can open the dialog on that place
function buildPlaceEntryHtml(place, index) {
	let yearsText = getPlaceYearsText(place, ` \u2013 `)
	let titleAttribute = place.note ? ` title="${escapeHtml(place.note)}"` : ``

	return `<div class="entry" data-place-index="${index}"${titleAttribute} onclick="openPlaceConnectionsDialog(${escapeHtml(JSON.stringify(place.name))})"><span class="name">${escapeHtml(place.name)}</span><span class="kind">${placeKindLabels[place.kind] ?? placeKindLabels.other}</span>${yearsText == `` ? `` : `<span class="years">${escapeHtml(yearsText)}</span>`}${place.links.length == 0 ? `` : `<span class="links">${buildPlaceLinksHtml(place.links)}</span>`}</div>`
}

function clearPlaces() {
	document.getElementById(`places`).innerHTML = ``
}

// The places of the person on screen are drawn in their own island under the relations and the timeline, with a heading that opens the dialog, the same as the lists of relations, an empty list is one dash that opens the same dialog
function renderPlaces(personId) {
	let person = persons[Number(personId)]

	if(!person){
		clearPlaces()

		return
	}

	let places = person.places ?? []
	let sortedPlaces = places
		.map((place, storedIndex) => ({
			place : place,
			storedIndex : storedIndex
		}))
		.sort(comparePlacesByLifeStage)

	document.getElementById(`places`).innerHTML = `<div class="heading" onclick="openPlacesDialog()"><span>Places</span><span class="action">+ <u>e</u>dit</span></div><div class="entries">${places.length == 0 ? `<div class="entry empty" onclick="openPlacesDialog()">\u2013</div>` : sortedPlaces.map((sortedPlace) => buildPlaceEntryHtml(sortedPlace.place, sortedPlace.storedIndex)).join(``)}</div>`
}

function getBlankPlaceDraft() {
	return {
		name : ``,
		kind : `lived`,
		fromYearText : ``,
		toYearText : ``,
		note : ``,
		links : []
	}
}

// A single event has one year, kept in the first box, a place saved with only a last year, which a single event used to be able to have, brings that year to the first box
function getPlaceDraftFromPlace(place) {
	let isSingleEvent = singleEventPlaceKinds.includes(place.kind)
	let fromYear = isSingleEvent ? place.fromYear ?? place.toYear ?? null : place.fromYear ?? null
	let toYear = isSingleEvent ? null : place.toYear ?? null

	return {
		name : place.name,
		kind : place.kind,
		fromYearText : fromYear == null ? `` : `${fromYear}`.padStart(4, `0`),
		toYearText : toYear == null ? `` : `${toYear}`.padStart(4, `0`),
		note : place.note ?? ``,
		links : [...place.links]
	}
}

function getSelectedPlaceDraft() {
	return placesDraft.entries[placesDraft.selectedIndex]
}

// The years of an entry of the dialog, written the same way as on the island, from the text that was typed
function getPlaceDraftYearsText(entry) {
	return getPlaceYearsText({
		kind : entry.kind,
		fromYear : entry.fromYearText == `` ? null : entry.fromYearText,
		toYear : entry.toYearText == `` ? null : entry.toYearText
	}, ` \u2013 `)
}

// What is wrong with an entry of the dialog, or an empty text, a place needs a name, a year that is typed needs 4 digits, and the first year cannot be after the last
function getPlaceDraftIssue(entry) {
	if(entry.name.trim() == ``){
		return `A place needs a name.`
	}

	let isSingleEvent = singleEventPlaceKinds.includes(entry.kind)

	for(let [label, yearText] of isSingleEvent ? [[`Year`, entry.fromYearText]] : [[`From year`, entry.fromYearText], [`To year`, entry.toYearText]]){
		if(yearText != `` && !/^\d{4}$/.test(yearText)){
			return `${label} needs 4 digits.`
		}
	}

	if(entry.fromYearText != `` && entry.toYearText != `` && Number(entry.fromYearText) > Number(entry.toYearText)){
		return `From year is after To year.`
	}

	return ``
}

// An entry with nothing in it at all is not a place, so it is left out when the dialog is saved, which is what happens to the empty entry that the dialog opens with
function isPlaceDraftBlank(entry) {
	return entry.name.trim() == `` && entry.fromYearText == `` && entry.toYearText == `` && entry.note.trim() == `` && entry.links.length == 0
}

function showPlacesIssue(issue) {
	document.getElementById(`placesIssue`).textContent = issue == `` ? `` : `\u26a0 ${issue}`
}

// The dialog opens on a copy of the places of the person on screen and on the entry that was asked for, a person with no places gets one empty entry so the boxes are ready to type in
function openPlacesDialog(selectedIndex = 0) {
	let personId = activeHistory.at(-1)
	let person = persons[personId]

	if(!person){
		return
	}

	placesDraft.personId = personId
	placesDraft.entries = (person.places ?? []).map(getPlaceDraftFromPlace)

	if(placesDraft.entries.length == 0){
		placesDraft.entries.push(getBlankPlaceDraft())
	}

	placesDraft.selectedIndex = Math.min(Math.max(Number(selectedIndex) || 0, 0), placesDraft.entries.length - 1)

	showPlacesIssue(``)
	fillPlacesForm()
	renderPlacesDialog()

	document.getElementById(`placesDialog`).showModal()
}

function closePlaces() {
	document.getElementById(`placesDialog`).close()
}

// Writes the boxes into the selected entry
function syncPlaceFromForm() {
	let entry = getSelectedPlaceDraft()

	if(!entry){
		return
	}

	entry.name = document.getElementById(`placeName`).value

	if(singleEventPlaceKinds.includes(entry.kind)){
		entry.fromYearText = document.getElementById(`placeYear`).value.trim()
		entry.toYearText = ``
	} else {
		entry.fromYearText = document.getElementById(`placeFromYear`).value.trim()
		entry.toYearText = document.getElementById(`placeToYear`).value.trim()
	}

	entry.note = document.getElementById(`placeNote`).value
	entry.links = readDynamicLinks(`placeLinks`)
}

// The boxes always show the selected entry, they are only filled when the selection changes so typing is never interrupted, the links are drawn with the rest of the editor
function fillPlacesForm() {
	let entry = getSelectedPlaceDraft()

	document.getElementById(`placeName`).value = entry?.name ?? ``
	document.getElementById(`placeYear`).value = entry?.fromYearText ?? ``
	document.getElementById(`placeFromYear`).value = entry?.fromYearText ?? ``
	document.getElementById(`placeToYear`).value = entry?.toYearText ?? ``
	document.getElementById(`placeNote`).value = entry?.note ?? ``

	updatePlaceYearInputs()
}

// A single event shows one Year box and the other kinds show From year and To year, the boxes that are not shown are hidden with the style and not with the hidden attribute, because the rows are flex rows that would show anyway
function updatePlaceYearInputs() {
	let isSingleEvent = singleEventPlaceKinds.includes(getSelectedPlaceDraft()?.kind)

	document.getElementById(`placeSingleYear`).style.display = isSingleEvent ? `` : `none`
	document.getElementById(`placeYearRange`).style.display = isSingleEvent ? `none` : ``
}

function renderPlacesDialog() {
	renderPlacesEntries()
	renderPlaceKindChoices()
	renderDynamicLinks(`placeLinks`, getSelectedPlaceDraft()?.links ?? [], () => updatePlacesDialog())
	renderPlaceSuggestions()
}

// The entries of the dialog, the selected one is marked, a place with no name yet is called New place, and every entry can be removed
function renderPlacesEntries() {
	document.getElementById(`placesEntries`).innerHTML = `<div class="heading"><span>Entered places</span></div>${placesDraft.entries.map((entry, index) => {
		let yearsText = getPlaceDraftYearsText(entry)

		return `<div class="entry person${index == placesDraft.selectedIndex ? ` selected` : ``}" onclick="selectPlaceEntry(${index})"><span class="text">${escapeHtml(entry.name.trim() == `` ? `New place` : entry.name.trim())}</span><span class="meta">${placeKindLabels[entry.kind]}${yearsText == `` ? `` : ` \u00b7 ${escapeHtml(yearsText)}`}</span><span class="remove" onclick="removePlaceEntry(event, ${index})">remove</span></div>`
	}).join(``)}`
}

function renderPlaceKindChoices() {
	let selectedKind = getSelectedPlaceDraft()?.kind

	document.getElementById(`placeKindChoices`).innerHTML = placeKinds
		.map((kind, index) => `<div class="choice${kind === selectedKind ? ` selected` : ``}" onclick="choosePlaceKind(${index})">${placeKindLabels[kind]}</div>`)
		.join(``)
}

// Changing the kind keeps what was typed, a single event takes the first year that there is, and a year that is still empty for a born or a died place is filled with the starred birth or death year of the person, so the year is only ever filled in when there is none, a span that is changed from a single event keeps its year as the first year
function choosePlaceKind(index) {
	syncPlaceFromForm()

	let entry = getSelectedPlaceDraft()

	if(!entry){
		return
	}

	entry.kind = placeKinds[index]

	if(singleEventPlaceKinds.includes(entry.kind)){
		entry.fromYearText = entry.fromYearText || entry.toYearText
		entry.toYearText = ``
	}

	let personYearKind = entry.kind == `born` ? `birth` : entry.kind == `died` ? `death` : null
	let personYear = personYearKind ? getPreferredDate(persons[placesDraft.personId], personYearKind)?.year : null

	if(personYear != null && entry.fromYearText == ``){
		entry.fromYearText = `${personYear}`.padStart(4, `0`)
	}

	showPlacesIssue(``)
	fillPlacesForm()
	renderPlacesEntries()
	renderPlaceKindChoices()
}

// The normalised names of the places of the immediate relatives of a person, their parents, siblings, partners and children, each place once, a relative written down as plain text has no page and so no places, the person themselves is not counted
function getFamilyPlaceKeys(personId) {
	let familyPlaceKeys = new Set()

	for(let role of [`parents`, `siblings`, `partners`, `children`]){
		for(let entry of persons[personId]?.relations?.[role] ?? []){
			let relative = entry.personId == null ? null : persons[Number(entry.personId)]

			if(!relative || Number(entry.personId) == Number(personId)){
				continue
			}

			for(let place of relative.places ?? []){
				familyPlaceKeys.add(normalizeNameText(place.name))
			}
		}
	}

	return familyPlaceKeys
}

// The names that are already used anywhere in the database, and by the other entries of the dialog, which match what is typed, the places of the immediate relatives come first and say Family, then the others in alphabetical order, a name that is already typed in full is not offered again, and the number of people who use it is shown
function renderPlaceSuggestions() {
	let suggestionsElement = document.getElementById(`placeSuggestions`)
	let typedText = document.getElementById(`placeName`).value
	let typedKey = normalizeNameText(typedText)

	if(typedKey == ``){
		placeSuggestionNames = []
		suggestionsElement.innerHTML = ``

		return
	}

	let knownPlaces = new Map()

	for(let place of getPlaceIndex().values()){
		knownPlaces.set(place.key, {
			name : place.name,
			personCount : place.personIds.size
		})
	}

	for(let [index, entry] of placesDraft.entries.entries()){
		let entryKey = normalizeNameText(entry.name)

		if(index != placesDraft.selectedIndex && entryKey != `` && !knownPlaces.has(entryKey)){
			knownPlaces.set(entryKey, {
				name : entry.name.trim(),
				personCount : 0
			})
		}
	}

	let typedTerms = typedKey.split(` `)
	let familyPlaceKeys = getFamilyPlaceKeys(placesDraft.personId)
	let suggestions = [...knownPlaces]
		.filter(([placeKey]) => placeKey != typedKey && typedTerms.every((term) => placeKey.includes(term)))
		.map(([placeKey, place]) => ({
			...place,
			isFamily : familyPlaceKeys.has(placeKey)
		}))
		.sort((firstPlace, secondPlace) => Number(secondPlace.isFamily) - Number(firstPlace.isFamily) || firstPlace.name.localeCompare(secondPlace.name))
		.slice(0, 6)
	let highlightTerms = splitSearchTerms(typedText)

	placeSuggestionNames = suggestions.map((suggestion) => suggestion.name)
	suggestionsElement.innerHTML = suggestions
		.map((suggestion, index) => `<div class="entry person" data-place onclick="choosePlaceSuggestion(${index})"><span class="text">${buildHighlightHtml(suggestion.name, highlightTerms)}</span><span class="meta">${[suggestion.isFamily ? `Family` : ``, suggestion.personCount == 0 ? `` : describeCount(suggestion.personCount, `person`, `people`)].filter((metaPart) => metaPart != ``).join(` \u00b7 `)}</span></div>`)
		.join(``)
}

function choosePlaceSuggestion(index) {
	let suggestionName = placeSuggestionNames[index]

	if(suggestionName === undefined){
		return
	}

	document.getElementById(`placeName`).value = suggestionName

	syncPlaceFromForm()
	showPlacesIssue(``)
	renderPlacesEntries()
	renderPlaceSuggestions()
}

// Enter picks the first suggestion and never saves the dialog
function handlePlaceNameKey(event) {
	if(event.key != `Enter`){
		return
	}

	event.preventDefault()

	document.querySelector(`#placeSuggestions>.entry[data-place]`)?.click()
}

// Every keystroke keeps the selected entry up to date, and in the name box it lists the names that match
function updatePlacesDialog(event) {
	syncPlaceFromForm()
	showPlacesIssue(``)
	renderPlacesEntries()

	if(event?.target.id == `placeName`){
		renderPlaceSuggestions()
	}
}

// Changing the selected entry keeps what was typed in the one that is left
function selectPlaceEntry(index) {
	syncPlaceFromForm()

	placesDraft.selectedIndex = index

	fillPlacesForm()
	renderPlacesDialog()
}

// A new empty entry is added to the copy and selected, and the name box is ready to type in
function addPlaceEntry() {
	syncPlaceFromForm()

	placesDraft.entries.push(getBlankPlaceDraft())

	placesDraft.selectedIndex = placesDraft.entries.length - 1

	fillPlacesForm()
	renderPlacesDialog()
	document.getElementById(`placeName`).focus()
}

// Takes an entry out of the copy, nothing is lost for good because Cancel throws the copy away, when the last one goes an empty one takes its place so the boxes stay ready, the click is stopped from reaching the row
function removePlaceEntry(event, index) {
	event.stopPropagation()
	syncPlaceFromForm()

	placesDraft.entries.splice(index, 1)

	if(placesDraft.entries.length == 0){
		placesDraft.entries.push(getBlankPlaceDraft())
	}

	if(index < placesDraft.selectedIndex){
		placesDraft.selectedIndex -= 1
	}

	placesDraft.selectedIndex = Math.min(placesDraft.selectedIndex, placesDraft.entries.length - 1)

	fillPlacesForm()
	renderPlacesDialog()
}

// The empty entries are left out, an entry that is not valid stays open, is selected and says why, otherwise the places are written to the person, saved, which counts as a change for the backup note, and the page is drawn again
function savePlaces(event) {
	event.preventDefault()
	syncPlaceFromForm()

	let person = persons[placesDraft.personId]

	if(!person){
		return
	}

	let places = []

	for(let [index, entry] of placesDraft.entries.entries()){
		if(isPlaceDraftBlank(entry)){
			continue
		}

		let issue = getPlaceDraftIssue(entry)

		if(issue != ``){
			placesDraft.selectedIndex = index

			fillPlacesForm()
			renderPlacesDialog()
			showPlacesIssue(issue)

			return
		}

		places.push(sanitizePlace({
			name : entry.name,
			kind : entry.kind,
			fromYear : entry.fromYearText == `` ? null : Number(entry.fromYearText),
			toYear : entry.toYearText == `` ? null : Number(entry.toYearText),
			note : entry.note,
			links : entry.links
		}))
	}

	if(places.length == 0){
		delete person.places
	} else {
		person.places = places
	}

	saveData()
	closePlaces()
	viewPerson()
}

// Everyone who has a place with this name, in alphabetical order, the line under each name says what the person did there and when, a person who has the place more than once gets all of them on the line, clicking a person closes the dialog and opens their page
function openPlaceConnectionsDialog(placeName) {
	let placeKey = normalizeNameText(placeName)
	let connections = []

	for(let [personId, person] of Object.entries(persons)){
		let matchingPlaces = (person.places ?? []).filter((place) => normalizeNameText(place.name) == placeKey)

		if(matchingPlaces.length > 0){
			connections.push({
				personId : Number(personId),
				person : person,
				places : matchingPlaces
			})
		}
	}

	connections.sort((firstConnection, secondConnection) => getNameLabel(firstConnection.person).localeCompare(getNameLabel(secondConnection.person)) || firstConnection.personId - secondConnection.personId)

	document.getElementById(`placeConnectionsTitle`).textContent = placeName
	document.getElementById(`placePeople`).innerHTML = connections.length == 0 ? `<div class="none">Nobody is connected to this place.</div>` : connections.map(buildPlaceConnectionHtml).join(``)

	if(!document.getElementById(`placeConnectionsDialog`).open){
		document.getElementById(`placeConnectionsDialog`).showModal()
	}
}

function buildPlaceConnectionHtml(connection) {
	let genderValue = getPreferredGender(connection.person)?.value ?? `unknown`
	let rolesText = connection.places
		.map((place) => {
			let yearsText = getPlaceYearsText(place, `\u2013`)

			return `${placeKindLabels[place.kind] ?? placeKindLabels.other}${yearsText == `` ? `` : ` \u00b7 ${yearsText}`}`
		})
		.join(`, `)

	return `<div class="row" onclick="openPlaceConnectionPerson(${connection.personId})"><span class="badge ${escapeHtml(genderValue)}"></span><span class="info"><span class="top"><span class="name">${escapeHtml(getNameLabel(connection.person))}</span></span><span class="issue">${escapeHtml(rolesText)}</span></span></div>`
}

function closePlaceConnections() {
	document.getElementById(`placeConnectionsDialog`).close()
}

function openPlaceConnectionPerson(personId) {
	closePlaceConnections()
	viewPerson(personId)
}

// A name as the words it is made of, without case, accents, punctuation and extra spaces, so St. Kilda and St Kilda are the same words and Adelaide, SA is the words Adelaide and SA
function getPlaceWords(placeName) {
	return normalizeNameText(placeName).replace(/[^\p{L}\p{N}\s]/gu, ` `).split(/\s+/).filter((word) => word != ``)
}

// A short word is an abbreviation of a longer one when it starts with the same letter and its letters are found in the longer one in the same order, so nth is an abbreviation of north, st of street and mt of mount
function isPlaceWordAbbreviation(shortWord, longWord) {
	if(shortWord.length < 2 || shortWord.length >= longWord.length || shortWord[0] != longWord[0]){
		return false
	}

	let longIndex = 0

	for(let letter of shortWord){
		longIndex = longWord.indexOf(letter, longIndex)

		if(longIndex == -1){
			return false
		}

		longIndex += 1
	}

	return true
}

function arePlaceWordsCompatible(firstWord, secondWord) {
	return firstWord == secondWord || isPlaceWordAbbreviation(firstWord, secondWord) || isPlaceWordAbbreviation(secondWord, firstWord)
}

// Two names that are not the same place but are probably meant to be, when they are the same words once punctuation and spaces are ignored, when every word of the shorter one matches the start of the longer one, such as Adelaide and Adelaide, SA, where a word may also be an abbreviation of the other, such as Salisbury Nth and Salisbury North, names of one word of fewer than 2 letters are never compared
function arePlaceNamesSimilar(firstName, secondName) {
	let firstWords = getPlaceWords(firstName)
	let secondWords = getPlaceWords(secondName)

	if(firstWords.join(``).length < 2 || secondWords.join(``).length < 2){
		return false
	}

	if(firstWords.join(` `) == secondWords.join(` `)){
		return true
	}

	let [shorterWords, longerWords] = firstWords.length <= secondWords.length ? [firstWords, secondWords] : [secondWords, firstWords]

	return shorterWords.every((word, index) => arePlaceWordsCompatible(word, longerWords[index]))
}

// For every place that has a similar one, the other places that it is similar to, the answer is a map from the normalised name of a place to a list of { name, personCount }, a place that nothing is similar to is not in it, the same place written with another case is one place, so it is never similar to itself
function getSimilarPlaces() {
	let places = [...getPlaceIndex().values()]
	let similarPlaces = new Map()

	for(let [index, place] of places.entries()){
		for(let otherPlace of places.slice(index + 1)){
			if(!arePlaceNamesSimilar(place.name, otherPlace.name)){
				continue
			}

			for(let [firstPlace, secondPlace] of [[place, otherPlace], [otherPlace, place]]){
				if(!similarPlaces.has(firstPlace.key)){
					similarPlaces.set(firstPlace.key, [])
				}

				similarPlaces.get(firstPlace.key).push({
					name : secondPlace.name,
					personCount : secondPlace.personIds.size
				})
			}
		}
	}

	return similarPlaces
}

// The places whose names match every word of the search, case and accents do not matter, each place once with the number of people who have it, only the names of places are looked at, never the people, so a person is never found by where they were
function findPlaceMatches(terms) {
	let normalizedTerms = terms.map(normalizeNameText).filter((term) => term != ``)

	if(normalizedTerms.length == 0){
		return []
	}

	return [...getPlaceIndex().values()]
		.filter((place) => normalizedTerms.every((term) => place.key.includes(term)))
		.map((place) => ({
			name : place.name,
			key : place.key,
			personCount : place.personIds.size
		}))
		.sort((firstMatch, secondMatch) => firstMatch.name.localeCompare(secondMatch.name))
}

// One place in the search results, the same shape as a person, with a fine text that says it is a place and how many people are connected to it
function buildPlaceSearchResultHtml(match, index, terms) {
	return `<div class="result" onclick="openPlaceSearchResult(${index})"><div class="text">${buildHighlightHtml(match.name, terms)}</div><div class="kind">Place \u00b7 ${describeCount(match.personCount, `person`, `people`)}</div></div>`
}

// The search box is cleared first, which draws the results again, so the place is read before that
function openPlaceSearchResult(index) {
	let match = placeSearchMatches[index]

	if(!match){
		return
	}

	closeSearch()
	openPlaceConnectionsDialog(match.name)
}
