let persons = JSON.parse(localStorage.getItem(`persons`)) || {}

// The history is the list of viewed people with the active person last, it is saved as well so a refresh brings back the same person and deleting still falls back to the one viewed before, ids of people that no longer exist are dropped when it is loaded
let activeHistory = (JSON.parse(localStorage.getItem(`activeHistory`)) || []).filter((id) => persons[id])

// What the note under the Export button needs, when the last export was and how many changes were made since, it is kept in the browser so it survives closing the page, savedDataText is the people as they were at the last save, so the next save can tell whether anything changed
let exportState = {
	exportedAt : null,
	changeCount : 0,
	loadedAt : null,
	loadedSource : null,
	lastChangedAt : null,
	...JSON.parse(localStorage.getItem(`exportState`))
}
let savedDataText = null
let exportWarningChangeCount = 20

// Everything that has to survive a refresh is written here
function saveData() {
	localStorage.setItem(`persons`, JSON.stringify(persons))
	localStorage.setItem(`activeHistory`, JSON.stringify(activeHistory))

	countChangesSinceLastSave()
	scheduleExportSizeUpdate()
}

// Names are typed by the user and end up inside innerHTML, so markup characters are escaped first
function escapeHtml(text) {
	return `${text}`
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`)
}

// Adding a person opens the name dialog first and the person only exists once a name is saved, so saving with no name entered, cancelling and closing the dialog all leave nothing behind
function addPerson() {
	isCreatingPerson = true

	openNameDialog(`New person`, getNameDraft(null))
}

// The window prompt is a confirm so nothing is removed unless OK is pressed, then every visit to that person is taken out of the history so viewPerson falls back to the person viewed before them
function deletePerson() {
	let id = activeHistory.at(-1)

	if(!persons[id] || !window.confirm(`Delete ${getNameLabel(persons[id])}?`)){
		return
	}

	unlinkPersonFromRelations(id)

	delete persons[id]
	activeHistory = activeHistory.filter((historyId) => historyId != id)

	viewPerson()
}

// Ids come back from localStorage as text so they are turned into numbers first, a person is only added to the history when they are not already the one on screen, and an id with no person clears the screen
function viewPerson(id = activeHistory.at(-1)) {
	id = Number(id)

	let person = persons[id]

	if(!person){
		document.getElementById(`header`).hidden = true

		document.getElementById(`name`).innerHTML = ``
		document.getElementById(`gender`).innerHTML = ``
		document.querySelector(`#header > .silhouette`).className = `silhouette unknown`
		document.getElementById(`lifespan`).innerHTML = ``

		clearRelations()
		updateRecentMenu()
		saveData()

		return
	}

	if(activeHistory.at(-1) !== id){
		activeHistory.push(id)
	}

	saveData()
	updateRecentMenu()

	document.getElementById(`name`).innerHTML = `<span class="rename" onclick="editName()">${escapeHtml(getNameLabel(person))}</span> <sup class="delete" onclick="deletePerson()">delete</sup>`

	document.querySelector(`#header > .silhouette`).className = `silhouette ${getPreferredGender(person)?.value ?? `unknown`}`
	document.getElementById(`gender`).innerHTML = buildGenderHtml(person)
	document.getElementById(`lifespan`).innerHTML = buildLifespanHtml(person)
	document.getElementById(`header`).hidden = false

	// What can be worked out from the parents is worked out each time a person is shown, and saved when it changed something
	if(runRelationInference(id)){
		saveData()
	}

	renderRelations(id)
}

// The menu lists the 10 most recent people other than the one on screen, newest first, each person only once
function updateRecentMenu() {
	let currentId = activeHistory.at(-1)
	let recentIds = [...new Set([...activeHistory].reverse())]
		.filter((id) => id !== currentId && persons[id])
		.slice(0, 10)

	document.getElementById(`recent`).innerHTML = recentIds
		.map((id) => `<div class="person" onclick="viewPerson(${id})">${escapeHtml(getNameLabel(persons[id]))}</div>`)
		.join(``)
}

// Going back drops the person on screen, and any repeats of them at the end of the history, so the person viewed before is shown, and nothing happens when there is nobody earlier
function goBack() {
	let currentId = activeHistory.at(-1)
	let previousIndex = activeHistory.findLastIndex((historyId) => historyId !== currentId)

	if(previousIndex == -1){
		return
	}

	activeHistory = activeHistory.slice(0, previousIndex + 1)

	viewPerson()
}

// The search box is split into words and a person matches when every word is found in one of their entered names, upper and lower case do not matter, so "smi jo" finds "John Smith" as well as "Smith Jonas"
function splitSearchTerms(text) {
	return text.toLowerCase().split(/\s+/).filter((term) => term != ``)
}

function getSearchTerms() {
	return splitSearchTerms(document.getElementById(`search`).value)
}

function isNameMatching(name, terms) {
	let nameText = formatNameText(name).toLowerCase()

	return terms.every((term) => nameText.includes(term))
}

// Every entered name is searched, not just the starred one, because a person may be remembered by a name that is not the one shown on their page, the starred name is the one listed when it matches, otherwise the first entry that does, and the list is sorted by that name
function findPersonMatches(terms) {
	let matches = []

	for(let [id, person] of Object.entries(persons)){
		let preferredName = getPreferredName(person)
		let matchedName = [preferredName, ...(person.names?.variants ?? [])].find((name) => isNameMatching(name, terms))

		if(!matchedName){
			continue
		}

		matches.push({
			id : id,
			text : formatNameText(matchedName),
			isPreferred : matchedName === preferredName,
			label : getNameLabel(person)
		})
	}

	return matches.sort((firstMatch, secondMatch) => firstMatch.text.localeCompare(secondMatch.text))
}

// Wraps every part of the text that matches a word in a mark, the places where the words are found are collected first and overlapping or touching ones are joined so the marks never nest, and every piece of text is escaped on its own
function buildHighlightHtml(text, terms) {
	let lowerText = text.toLowerCase()
	let foundRanges = []

	for(let term of terms){
		let startIndex = lowerText.indexOf(term)

		while(startIndex != -1){
			foundRanges.push({
				startIndex : startIndex,
				endIndex : startIndex + term.length
			})

			startIndex = lowerText.indexOf(term, startIndex + term.length)
		}
	}

	foundRanges.sort((firstRange, secondRange) => firstRange.startIndex - secondRange.startIndex)

	let joinedRanges = []

	for(let range of foundRanges){
		let lastRange = joinedRanges.at(-1)

		if(lastRange && range.startIndex <= lastRange.endIndex){
			lastRange.endIndex = Math.max(lastRange.endIndex, range.endIndex)
		} else {
			joinedRanges.push({ ...range })
		}
	}

	let html = ``
	let position = 0

	for(let range of joinedRanges){
		html += `${escapeHtml(text.slice(position, range.startIndex))}<mark>${escapeHtml(text.slice(range.startIndex, range.endIndex))}</mark>`
		position = range.endIndex
	}

	return `${html}${escapeHtml(text.slice(position))}`
}

// The fine text says how the person is related to the person on screen, or Person when they are not, and when the name that matched is not the starred one the name the page shows is added so the result is not a surprise
function buildSearchResultHtml(match, terms) {
	return `<div class="result" onclick="openSearchResult(${match.id})"><div class="text">${buildHighlightHtml(match.text, terms)}</div><div class="kind">${escapeHtml(getKinshipLabel(match.id))}${match.isPreferred ? `` : ` \u00b7 shown as ${escapeHtml(match.label)}`}</div></div>`
}

// Runs on every keystroke and when the box is focused again, an empty box lists nothing, only people can be found
function updateSearch() {
	let terms = getSearchTerms()
	let resultsElement = document.getElementById(`results`)

	if(terms.length == 0){
		resultsElement.innerHTML = ``

		return
	}

	let personMatches = findPersonMatches(terms)

	if(personMatches.length == 0){
		resultsElement.innerHTML = `<div class="none">No results found</div>`

		return
	}

	resultsElement.innerHTML = `<div class="heading">People</div>${personMatches.map((match) => buildSearchResultHtml(match, terms)).join(``)}`
}

function closeSearch() {
	document.getElementById(`search`).value = ``

	updateSearch()

	document.getElementById(`search`).blur()
}

function openSearchResult(id) {
	viewPerson(id)
	closeSearch()
}

// Enter opens the first result and Escape gives up the search
function handleSearchKey(event) {
	if(event.key == `Escape`){
		closeSearch()
	} else if(event.key == `Enter`){
		document.querySelector(`#results>.result`)?.click()
	}
}

// A birth or a death is a list of entered dates because sources disagree, each entry is { year, month, day, order, link, note } with null for every part that is not known, order saying how close the source is and link and note being optional, preferredVariantIndex is the starred entry that the person's page shows, and a person with no entered dates has no such property at all
let monthNames = [`Jan`, `Feb`, `Mar`, `Apr`, `May`, `Jun`, `Jul`, `Aug`, `Sep`, `Oct`, `Nov`, `Dec`]
let monthFullNames = [`January`, `February`, `March`, `April`, `May`, `June`, `July`, `August`, `September`, `October`, `November`, `December`]
let editedDateKind = `birth`

// Both lists are edited together in one dialog, so each has its own copy in dateDrafts, and dateDraft is the copy of the side on show, the death copy also keeps whether the person is declared dead with no date
let dateDrafts = {}
let dateDraft = {
	variants : [],
	preferredVariantIndex : 0,
	selectedIndex : 0
}

// The orders of source from the closest to the person to the furthest away, each has a name, a short label and a description of what kind of source it is
let sourceOrders = [
	{
		order : 1,
		name : `1st order`,
		label : `Direct`,
		description : `Told by the person themselves, or read from an official document you have seen, such as a certificate, passport or gravestone.`
	},
	{
		order : 2,
		name : `2nd order`,
		label : `Witness`,
		description : `Told by someone who was there or is very close to them, such as a parent, partner, sibling or child.`
	},
	{
		order : 3,
		name : `3rd order`,
		label : `Second hand`,
		description : `Told by someone who heard it from another person, such as a friend, a colleague or wider family.`
	},
	{
		order : 4,
		name : `4th order`,
		label : `Hearsay`,
		description : `A rumour, a vague memory, or something posted with no source.`
	},
	{
		order : 5,
		name : `5th order`,
		label : `Inferred`,
		description : `Worked out from other facts, such as "was 30 in 1980".`
	}
]

// A person who is not marked as deceased and who must be at least this old is flagged as improbably old
let improbableAge = 110

// Only web addresses become clickable links so a pasted javascript: address can never run when it is clicked
function isWebAddress(url) {
	return /^https?:\/\//i.test(url)
}

// A link is shown as its host name so long addresses do not fill the dialog, and anything that does not parse as an address is shown as typed
function getLinkLabel(url) {
	try {
		return new URL(url).hostname.replace(`www.`, ``)
	} catch {
		return url
	}
}

function getSourceOrder(order) {
	return sourceOrders.find((sourceOrder) => sourceOrder.order === order)
}

function getBlankDate() {
	return {
		year : null,
		month : null,
		day : null,
		order : null,
		link : null,
		note : null
	}
}

function isDateEmpty(date) {
	return date.year == null && date.month == null && date.day == null
}

// Dates saved before there were lists were a single { year, month, day }, they become a list of one entry with no source order
function migrateDates(person) {
	for(let kind of [`birth`, `death`]){
		if(person[kind] && !Array.isArray(person[kind].variants)){
			person[kind] = {
				preferredVariantIndex : 0,
				variants : [
					{
						year : person[kind].year ?? null,
						month : person[kind].month ?? null,
						day : person[kind].day ?? null,
						order : null,
						link : null,
						note : null
					}
				]
			}
		}
	}
}

// The entry that the person's page shows, which is the starred one, or null when nothing was entered
function getPreferredDate(person, kind) {
	let field = person[kind]

	if(!field || field.variants.length == 0){
		return null
	}

	return field.variants[field.preferredVariantIndex] ?? field.variants[0]
}

function getDaysInMonth(year, month) {
	let isLeapYear = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0

	return [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

// Any part may be left empty, the parts that are given just have to be real, and a day only makes sense with a month, when the year is unknown a leap year is assumed so the 29th of February is allowed
function getDateIssue(day, month, year) {
	if(year != `` && !/^\d{4}$/.test(year)){
		return `Year needs 4 digits`
	}

	if(month != `` && !(/^\d{1,2}$/.test(month) && Number(month) >= 1 && Number(month) <= 12)){
		return `Month must be 1\u201312`
	}

	if(day != ``){
		if(month == ``){
			return `A day needs a month`
		}

		let mostDays = getDaysInMonth(year == `` ? 2000 : Number(year), Number(month))

		if(!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > mostDays){
			return `Day must be 1\u2013${mostDays}`
		}
	}

	return ``
}

// 1st, 2nd, 3rd and 4th, with the teens as 11th, 12th and 13th, and 21st, 22nd, 23rd and so on
function getOrdinal(number) {
	let lastTwoDigits = number % 100
	let suffixes = {
		1 : `st`,
		2 : `nd`,
		3 : `rd`
	}

	return `${number}${lastTwoDigits >= 11 && lastTwoDigits <= 13 ? `th` : suffixes[number % 10] ?? `th`}`
}

// A date written out in full with whatever is known, such as 14th Mar 1950, Mar 1950, 1950 or Mar ? when only the month is known
function formatDateText(date) {
	return [
		date.day == null ? `` : getOrdinal(date.day),
		date.month == null ? `` : monthNames[date.month - 1],
		date.year ?? (isDateEmpty(date) ? `` : `?`)
	].filter((part) => part !== ``).join(` `)
}

// A person declared dead with no date gets a death date with nothing known in it, which is shown as a question mark, and a person with no death at all gets nothing
function getDeathDate(person) {
	let death = getPreferredDate(person, `death`)

	if(death){
		return death
	}

	return person.isDeceased ? getBlankDate() : null
}

function getToday() {
	let now = new Date()

	return {
		year : now.getFullYear(),
		month : now.getMonth() + 1,
		day : now.getDate()
	}
}

// The label is always written out in full and the day and month are always shown before the year, a date that was never entered shows a dash
function buildDateHtml(labelText, date, clickText) {
	let valueHtml = `<span class="empty">\u2013</span>`

	if(date){
		let detailText = date.month == null ? `` : `${date.day == null ? `` : `${getOrdinal(date.day)} `}${monthNames[date.month - 1]}`

		valueHtml = `${detailText == `` ? `` : `<span class="detail">${detailText}</span>`}<span class="year">${date.year ?? `?`}</span>`
	}

	return `<span class="date" onclick="${clickText}"><span class="label">${labelText}.</span>${valueHtml}</span>`
}

// The earliest and latest dates a partly known date could really be, an unknown month means January to December and an unknown day means the whole month
function getDateBounds(date) {
	let hasMonth = date.month != null

	return {
		earliest : {
			year : date.year,
			month : hasMonth ? date.month : 1,
			day : hasMonth && date.day != null ? date.day : 1
		},
		latest : {
			year : date.year,
			month : hasMonth ? date.month : 12,
			day : hasMonth ? date.day ?? getDaysInMonth(date.year, date.month) : 31
		}
	}
}

// Whole years lived, one less than the difference in years when the birthday has not come round yet on the later date
function getAgeBetween(birth, death) {
	let isBeforeBirthday = death.month < birth.month || (death.month == birth.month && death.day < birth.day)

	return death.year - birth.year - (isBeforeBirthday ? 1 : 0)
}

// The youngest they can have been is the latest birth against the earliest later date and the oldest is the earliest birth against the latest later date, the later date is the death or today, and null means there are not enough years to say
function getAgeRange(birth, laterDate) {
	if(birth?.year == null || laterDate?.year == null){
		return null
	}

	let birthBounds = getDateBounds(birth)
	let laterBounds = getDateBounds(laterDate)

	return {
		youngest : getAgeBetween(birthBounds.latest, laterBounds.earliest),
		oldest : getAgeBetween(birthBounds.earliest, laterBounds.latest)
	}
}

// Years alone give a range such as 70-71 and enough month and day narrow it to one age, and a warning sign means the later date comes before the birth
function getAgeText(birth, laterDate) {
	let range = getAgeRange(birth, laterDate)

	if(!range){
		return ``
	}

	if(range.oldest < 0){
		return `\u26a0`
	}

	let youngest = Math.max(range.youngest, 0)

	return youngest == range.oldest ? `${range.oldest}` : `${youngest}-${range.oldest}`
}

// The age is written out as years old and a single year is singular, an impossible order of dates says so in words because there is no tooltip to explain a warning sign, and extra html such as the improbably old notice can follow the age
function buildAgeSpan(ageText, className, warningText, extraHtml = ``) {
	if(ageText == ``){
		return ``
	}

	if(ageText == `\u26a0`){
		return `<span class="age ${className}">\u26a0 ${warningText}</span>`
	}

	return `<span class="age ${className}">${ageText} ${ageText == `1` ? `year` : `years`} old${extraHtml == `` ? `` : ` ${extraHtml}`}</span>`
}

// Years since the birth year, written as years ago, for a person who is no longer alive, it is only the difference of two years so it does not depend on the month or the day
function buildYearsAgoSpan(birth) {
	if(birth?.year == null){
		return ``
	}

	let yearCount = getToday().year - birth.year

	if(yearCount < 0){
		return ``
	}

	return `<span class="age yearsAgo">${yearCount} ${yearCount == 1 ? `year` : `years`} ago</span>`
}

// A living person gets their age today beside the birth line, with a coloured notice when they must be at least the improbable age, and clicking the notice opens the death dialog so they can be marked as deceased, a person who is not alive gets the years ago beside the birth line instead, except when an age at death can be shown beside the death line because that age already says it, a death before the birth only has a warning to show so it does not count as an age
function buildAgeHtml(person) {
	let birth = getPreferredDate(person, `birth`)
	let death = getPreferredDate(person, `death`)

	if(death){
		let ageAtDeathText = getAgeText(birth, death)
		let isAgeShown = ageAtDeathText != `` && ageAtDeathText != `\u26a0`

		return `${isAgeShown ? `` : buildYearsAgoSpan(birth)}${buildAgeSpan(ageAtDeathText, `atDeath`, `death is before birth`)}`
	}

	if(person.isDeceased){
		return buildYearsAgoSpan(birth)
	}

	let range = getAgeRange(birth, getToday())
	let alertHtml = range && range.youngest >= improbableAge ? `<span class="alert" onclick="editDeath()">! improbably old, is this person deceased?</span>` : ``

	return buildAgeSpan(getAgeText(birth, getToday()), `current`, `birth is in the future`, alertHtml)
}

// The birth line is always there because it is where a date is first entered, the death line only when there is a death date or the person is declared dead, a person it does not apply to has no death line and gets to the death side from the date dialog, then the ages beside them, the grid in the stylesheet places them in columns
function buildLifespanHtml(person) {
	let birth = getPreferredDate(person, `birth`)
	let hasDeath = getPreferredDate(person, `death`) != null || person.isDeceased == true

	return `${buildDateHtml(`birth`, birth, `editBirth()`)}${hasDeath ? buildDateHtml(`death`, getDeathDate(person), `editDeath()`) : ``}${buildAgeHtml(person)}`
}

function editBirth() {
	editDate(`birth`)
}

function editDeath() {
	editDate(`death`)
}

// The orders are a row of small buttons and the meaning of the chosen one is written underneath, a hint stands in its place while none is chosen so the dialog never changes height, the chosen one is kept in a hidden box so the rest of the dialog can read it like any other box
function renderOrderChoices() {
	let chosenSourceOrder = getSourceOrder(Number(document.getElementById(`dateOrder`).value))

	document.getElementById(`dateOrderChoices`).innerHTML = sourceOrders
		.map((sourceOrder) => `<div class="choice${sourceOrder.order === chosenSourceOrder?.order ? ` selected` : ``}" onclick="chooseDateOrder(${sourceOrder.order})">${sourceOrder.label}</div>`)
		.join(``)

	document.getElementById(`dateOrderDescription`).textContent = chosenSourceOrder ? `${chosenSourceOrder.name} \u00b7 ${chosenSourceOrder.description}` : `Choose how close this source is to the person.`
}

// Choosing the order that is already chosen clears it again
function chooseDateOrder(order) {
	let orderInput = document.getElementById(`dateOrder`)

	orderInput.value = orderInput.value == `${order}` ? `` : order

	updateDateDialog()
}

function readDateForm() {
	return {
		day : document.getElementById(`dateDay`).value.trim(),
		month : document.getElementById(`dateMonth`).value.trim(),
		year : document.getElementById(`dateYear`).value.trim(),
		order : document.getElementById(`dateOrder`).value,
		link : document.getElementById(`dateLink`).value.trim(),
		note : document.getElementById(`dateNote`).value.trim()
	}
}

function clearDateIssue() {
	document.getElementById(`dateIssue`).textContent = ``
}

function showDateIssue(issue) {
	document.getElementById(`dateIssue`).textContent = `\u26a0 ${issue}`
}

// The boxes always show the selected entry, an empty entry is allowed while editing and is dropped when the dialog is saved
function fillDateForm(date) {
	document.getElementById(`dateDay`).value = date?.day ?? ``
	document.getElementById(`dateMonth`).value = date?.month ?? ``
	document.getElementById(`dateYear`).value = date?.year ?? ``
	document.getElementById(`dateOrder`).value = date?.order ?? ``
	document.getElementById(`dateLink`).value = date?.link ?? ``
	document.getElementById(`dateNote`).value = date?.note ?? ``

	clearDateIssue()
	renderOrderChoices()
}

// Writes the boxes into the selected entry and returns what is wrong with the date, or an empty text when it was written, so an impossible date never reaches the list
function syncDraftFromForm() {
	let form = readDateForm()
	let issue = getDateIssue(form.day, form.month, form.year)

	if(issue != ``){
		return issue
	}

	dateDraft.variants[dateDraft.selectedIndex] = {
		year : form.year == `` ? null : Number(form.year),
		month : form.month == `` ? null : Number(form.month),
		day : form.day == `` ? null : Number(form.day),
		order : form.order == `` ? null : Number(form.order),
		link : form.link == `` ? null : form.link,
		note : form.note == `` ? null : form.note
	}

	return ``
}

// The optional note and link go on a second line of the entry, a link is only clickable when it is a web address, and clicking it must not also select the entry
function buildDateEntryHtml(date, index) {
	let sourceOrder = getSourceOrder(date.order)
	let isEmpty = isDateEmpty(date)
	let extraParts = []

	if(date.note){
		extraParts.push(escapeHtml(date.note))
	}

	if(date.link){
		extraParts.push(isWebAddress(date.link)
			? `<a href="${escapeHtml(date.link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHtml(getLinkLabel(date.link))}</a>`
			: escapeHtml(date.link))
	}

	return `<div class="entry${index == dateDraft.selectedIndex ? ` selected` : ``}${isEmpty ? ` blank` : ``}" onclick="selectDateEntry(${index})"><span class="star" onclick="starDateEntry(event, ${index})">${index == dateDraft.preferredVariantIndex ? `\u2605` : `\u2606`}</span><span class="text">${isEmpty ? `New date` : formatDateText(date)}</span><span class="meta">${sourceOrder ? `${sourceOrder.name} \u00b7 ${sourceOrder.label}` : `Source not set`}</span><span class="remove" onclick="removeDateEntry(event, ${index})">remove</span>${extraParts.length > 0 ? `<span class="extra">${extraParts.join(` \u00b7 `)}</span>` : ``}</div>`
}

// The list of entered dates is only shown once there is something to list, the star marks the entry the page will show
function renderDateList() {
	let isOnlyBlank = dateDraft.variants.length == 1 && isDateEmpty(dateDraft.variants[0])

	document.getElementById(`dateList`).innerHTML = isOnlyBlank ? `` : `<div class="heading"><span>Entered dates</span><span class="action" onclick="addAnotherDate()">+ add another</span></div>${dateDraft.variants.map(buildDateEntryHtml).join(``)}`
}

// The checkbox only means something while there are no dates at all, so any date in the list or in the boxes switches it off and disables it
function syncDeceasedCheckbox() {
	if(editedDateKind != `death`){
		return
	}

	let form = readDateForm()
	let hasAnyDate = dateDraft.variants.some((date) => !isDateEmpty(date)) || form.day != `` || form.month != `` || form.year != ``

	document.getElementById(`dateDeceased`).disabled = hasAnyDate

	if(hasAnyDate){
		document.getElementById(`dateDeceased`).checked = false
	}
}

// A copy of one list for the dialog to work on, with one blank entry when nothing was entered yet, and the selection on the starred entry
function getDateDraft(field) {
	let variants = (field?.variants ?? []).map((date) => ({ ...date }))
	let preferredVariantIndex = field?.preferredVariantIndex ?? 0

	if(variants.length == 0){
		variants.push(getBlankDate())
	}

	return {
		variants : variants,
		preferredVariantIndex : preferredVariantIndex,
		selectedIndex : Math.min(preferredVariantIndex, variants.length - 1)
	}
}

// The tab of the side on show is marked
function renderDateTabs() {
	document.getElementById(`birthTab`).className = editedDateKind == `birth` ? `selected` : ``
	document.getElementById(`deathTab`).className = editedDateKind == `death` ? `selected` : ``
}

// Shows one of the two lists with the boxes filled from its selected entry, the checkbox for a death with no known date only exists on the death side and is filled from what the death copy remembers
function showDateKind(kind) {
	editedDateKind = kind
	dateDraft = dateDrafts[kind]

	document.getElementById(`deceasedLabel`).hidden = kind == `birth`
	document.getElementById(`dateDeceased`).checked = kind == `death` && dateDraft.isDeceased

	fillDateForm(dateDraft.variants[dateDraft.selectedIndex])
	renderDateTabs()
	renderDateList()
	syncDeceasedCheckbox()
}

// The checkbox is one box shared by both sides, so what it says is kept with the death copy before the box is used for anything else
function keepDeceasedFlag() {
	if(editedDateKind == `death`){
		dateDrafts.death.isDeceased = document.getElementById(`dateDeceased`).checked
	}
}

// Changing side keeps what was typed on the side being left, and an impossible date stays put and says why, the same as moving between entries does
function switchDateKind(kind) {
	if(kind == editedDateKind){
		return
	}

	let issue = syncDraftFromForm()

	if(issue != ``){
		showDateIssue(issue)

		return
	}

	keepDeceasedFlag()
	showDateKind(kind)
}

// The dialog works on copies of both lists, so Cancel throws every change away, it opens on the side that was asked for, on the starred entry with the boxes filled in
function editDate(kind) {
	let person = persons[activeHistory.at(-1)]

	if(!person){
		return
	}

	dateDrafts = {
		birth : getDateDraft(person.birth),
		death : getDateDraft(person.death)
	}

	dateDrafts.death.isDeceased = !getPreferredDate(person, `death`) && person.isDeceased == true

	showDateKind(kind)

	document.getElementById(`dateDialog`).showModal()
}

function closeDate() {
	document.getElementById(`dateDialog`).close()
}

// Every keystroke keeps the selected entry, the list and the checkbox up to date, an impossible date simply is not written until it is fixed
function updateDateDialog() {
	clearDateIssue()
	syncDraftFromForm()
	renderOrderChoices()
	renderDateList()
	syncDeceasedCheckbox()
}

function selectDateEntry(index) {
	let issue = syncDraftFromForm()

	if(issue != ``){
		showDateIssue(issue)

		return
	}

	dateDraft.selectedIndex = index

	fillDateForm(dateDraft.variants[index])
	renderDateList()
	syncDeceasedCheckbox()
}

// A new blank entry is added and selected, unless the selected entry is already blank
function addAnotherDate() {
	let issue = syncDraftFromForm()

	if(issue != ``){
		showDateIssue(issue)

		return
	}

	if(!isDateEmpty(dateDraft.variants[dateDraft.selectedIndex])){
		dateDraft.variants.push(getBlankDate())
		dateDraft.selectedIndex = dateDraft.variants.length - 1
	}

	fillDateForm(dateDraft.variants[dateDraft.selectedIndex])
	renderDateList()
	syncDeceasedCheckbox()
}

// The star is inside a row that selects itself when clicked, so the click is stopped from reaching the row
function starDateEntry(event, index) {
	event.stopPropagation()

	dateDraft.preferredVariantIndex = index

	renderDateList()
}

// Takes one entry out of the copy being edited, nothing is lost for good because Cancel throws the copy away, the click is stopped from reaching the row, the star and the selection follow their entries when the ones before them move up, the star falls back to the first entry when its own entry is removed, and removing the last entry leaves one blank entry so the dialog looks as it does for a person with no date, a date that is typed wrongly in the boxes only blocks removing another entry because removing the selected entry throws those boxes away anyway
function removeDateEntry(event, index) {
	event.stopPropagation()

	if(index != dateDraft.selectedIndex){
		let issue = syncDraftFromForm()

		if(issue != ``){
			showDateIssue(issue)

			return
		}
	}

	dateDraft.variants.splice(index, 1)

	if(dateDraft.variants.length == 0){
		dateDraft.variants.push(getBlankDate())
	}

	if(dateDraft.preferredVariantIndex == index){
		dateDraft.preferredVariantIndex = 0
	} else if(dateDraft.preferredVariantIndex > index){
		dateDraft.preferredVariantIndex -= 1
	}

	if(dateDraft.selectedIndex > index){
		dateDraft.selectedIndex -= 1
	}

	dateDraft.selectedIndex = Math.min(dateDraft.selectedIndex, dateDraft.variants.length - 1)

	fillDateForm(dateDraft.variants[dateDraft.selectedIndex])
	renderDateList()
	syncDeceasedCheckbox()
}

// An impossible date keeps the dialog open and says why, otherwise for each side the empty entries are dropped, which is how a date is removed, the star follows its entry and falls back to the first when its entry was dropped, a list left empty removes the property, in which case the checkbox decides whether a death is still declared, and viewPerson redraws the lifespan and saves
function saveDate(event) {
	event.preventDefault()

	let person = persons[activeHistory.at(-1)]

	if(!person){
		return
	}

	let issue = syncDraftFromForm()

	if(issue != ``){
		showDateIssue(issue)

		return
	}

	keepDeceasedFlag()

	for(let kind of [`birth`, `death`]){
		let draft = dateDrafts[kind]
		let keptIndexes = draft.variants
			.map((date, index) => index)
			.filter((index) => !isDateEmpty(draft.variants[index]))

		if(keptIndexes.length == 0){
			delete person[kind]
		} else {
			person[kind] = {
				preferredVariantIndex : Math.max(keptIndexes.indexOf(draft.preferredVariantIndex), 0),
				variants : keptIndexes.map((index) => draft.variants[index])
			}
		}

		if(kind == `death`){
			person.isDeceased = keptIndexes.length == 0 && draft.isDeceased

			if(!person.isDeceased){
				delete person.isDeceased
			}
		}
	}

	closeDate()
	viewPerson()
}

// A name is a list of entered names because sources disagree, each entry is { firstName, lastName, order, link, note } with null for every part that is not entered, preferredVariantIndex is the starred entry that is used everywhere the person is named, and every person has at least one entry
let nameDraft = {
	variants : [],
	preferredVariantIndex : 0,
	selectedIndex : 0
}
let isCreatingPerson = false

function getBlankName() {
	return {
		firstName : null,
		lastName : null,
		order : null,
		link : null,
		note : null
	}
}

function isNameEmpty(name) {
	return name.firstName == null && name.lastName == null
}

function formatNameText(name) {
	return [name.firstName, name.lastName].filter((part) => part != null).join(` `)
}

// The entry that the person is named by, which is the starred one
function getPreferredName(person) {
	let field = person.names

	return field?.variants[field.preferredVariantIndex] ?? field?.variants[0] ?? getBlankName()
}

// The name as it is written on the page, in the recent menu and in the delete question, a person with no name text at all is called Unnamed so there is still something to click
function getNameLabel(person) {
	return formatNameText(getPreferredName(person)) || `Unnamed`
}

// Names saved before they could have sources were a first and a last name on the person, they become a list of one entry with no source order
function migrateNames(person) {
	if(person.names){
		return
	}

	person.names = {
		preferredVariantIndex : 0,
		variants : [
			{
				firstName : person.firstName || null,
				lastName : person.lastName || null,
				order : null,
				link : null,
				note : null
			}
		]
	}

	delete person.firstName
	delete person.lastName
}

// A copy of the list for the dialog to work on, with one blank entry when there is nothing yet, and the selection on the starred entry
function getNameDraft(field) {
	let variants = (field?.variants ?? []).map((name) => ({ ...name }))
	let preferredVariantIndex = field?.preferredVariantIndex ?? 0

	if(variants.length == 0){
		variants.push(getBlankName())
	}

	return {
		variants : variants,
		preferredVariantIndex : preferredVariantIndex,
		selectedIndex : Math.min(preferredVariantIndex, variants.length - 1)
	}
}

function readNameForm() {
	return {
		firstName : document.getElementById(`nameFirst`).value.trim(),
		lastName : document.getElementById(`nameLast`).value.trim(),
		order : document.getElementById(`nameOrder`).value,
		link : document.getElementById(`nameLink`).value.trim(),
		note : document.getElementById(`nameNote`).value.trim()
	}
}

function clearNameIssue() {
	document.getElementById(`nameIssue`).textContent = ``
}

function showNameIssue(issue) {
	document.getElementById(`nameIssue`).textContent = `\u26a0 ${issue}`
}

// The orders are a row of small buttons and the meaning of the chosen one is written underneath, the same as in the date dialog, the chosen one is kept in a hidden box
function renderNameOrderChoices() {
	let chosenSourceOrder = getSourceOrder(Number(document.getElementById(`nameOrder`).value))

	document.getElementById(`nameOrderChoices`).innerHTML = sourceOrders
		.map((sourceOrder) => `<div class="choice${sourceOrder.order === chosenSourceOrder?.order ? ` selected` : ``}" onclick="chooseNameOrder(${sourceOrder.order})">${sourceOrder.label}</div>`)
		.join(``)

	document.getElementById(`nameOrderDescription`).textContent = chosenSourceOrder ? `${chosenSourceOrder.name} \u00b7 ${chosenSourceOrder.description}` : `Choose how close this source is to the person.`
}

// Choosing the order that is already chosen clears it again
function chooseNameOrder(order) {
	let orderInput = document.getElementById(`nameOrder`)

	orderInput.value = orderInput.value == `${order}` ? `` : order

	updateNameDialog()
}

// The boxes always show the selected entry, an empty entry is allowed while editing and is dropped when the dialog is saved
function fillNameForm(name) {
	document.getElementById(`nameFirst`).value = name?.firstName ?? ``
	document.getElementById(`nameLast`).value = name?.lastName ?? ``
	document.getElementById(`nameOrder`).value = name?.order ?? ``
	document.getElementById(`nameLink`).value = name?.link ?? ``
	document.getElementById(`nameNote`).value = name?.note ?? ``

	clearNameIssue()
	renderNameOrderChoices()
}

// Writes the boxes into the selected entry, a name has no way to be impossible so this always works
function syncNameDraftFromForm() {
	let form = readNameForm()

	nameDraft.variants[nameDraft.selectedIndex] = {
		firstName : form.firstName == `` ? null : form.firstName,
		lastName : form.lastName == `` ? null : form.lastName,
		order : form.order == `` ? null : Number(form.order),
		link : form.link == `` ? null : form.link,
		note : form.note == `` ? null : form.note
	}
}

// The optional note and link go on a second line of the entry, a link is only clickable when it is a web address, and clicking it must not also select the entry
function buildNameEntryHtml(name, index) {
	let sourceOrder = getSourceOrder(name.order)
	let isEmpty = isNameEmpty(name)
	let extraParts = []

	if(name.note){
		extraParts.push(escapeHtml(name.note))
	}

	if(name.link){
		extraParts.push(isWebAddress(name.link)
			? `<a href="${escapeHtml(name.link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHtml(getLinkLabel(name.link))}</a>`
			: escapeHtml(name.link))
	}

	return `<div class="entry${index == nameDraft.selectedIndex ? ` selected` : ``}${isEmpty ? ` blank` : ``}" onclick="selectNameEntry(${index})"><span class="star" onclick="starNameEntry(event, ${index})">${index == nameDraft.preferredVariantIndex ? `\u2605` : `\u2606`}</span><span class="text">${isEmpty ? `New name` : escapeHtml(formatNameText(name))}</span><span class="meta">${sourceOrder ? `${sourceOrder.name} \u00b7 ${sourceOrder.label}` : `Source not set`}</span><span class="remove" onclick="removeNameEntry(event, ${index})">remove</span>${extraParts.length > 0 ? `<span class="extra">${extraParts.join(` \u00b7 `)}</span>` : ``}</div>`
}

// The list of entered names is only shown once there is something to list, the star marks the entry the person is named by
function renderNameList() {
	let isOnlyBlank = nameDraft.variants.length == 1 && isNameEmpty(nameDraft.variants[0])

	document.getElementById(`nameList`).innerHTML = isOnlyBlank ? `` : `<div class="heading"><span>Entered names</span><span class="action" onclick="addAnotherName()">+ add another</span></div>${nameDraft.variants.map(buildNameEntryHtml).join(``)}`
}

// The dialog works on a copy of the list so Cancel throws every change away, the same dialog serves a person who exists and a person who is being added
function openNameDialog(title, draft) {
	nameDraft = draft

	document.getElementById(`nameTitle`).textContent = title

	fillNameForm(nameDraft.variants[nameDraft.selectedIndex])
	renderNameList()

	document.getElementById(`nameDialog`).showModal()
}

function editName() {
	let person = persons[activeHistory.at(-1)]

	if(!person){
		return
	}

	isCreatingPerson = false

	openNameDialog(`Name`, getNameDraft(person.names))
}

function closeName() {
	document.getElementById(`nameDialog`).close()
}

// Every keystroke keeps the selected entry and the list up to date
function updateNameDialog() {
	clearNameIssue()
	syncNameDraftFromForm()
	renderNameOrderChoices()
	renderNameList()
}

function selectNameEntry(index) {
	syncNameDraftFromForm()

	nameDraft.selectedIndex = index

	fillNameForm(nameDraft.variants[index])
	renderNameList()
}

// A new blank entry is added and selected, unless the selected entry is already blank
function addAnotherName() {
	syncNameDraftFromForm()

	if(!isNameEmpty(nameDraft.variants[nameDraft.selectedIndex])){
		nameDraft.variants.push(getBlankName())
		nameDraft.selectedIndex = nameDraft.variants.length - 1
	}

	fillNameForm(nameDraft.variants[nameDraft.selectedIndex])
	renderNameList()
}

// The star is inside a row that selects itself when clicked, so the click is stopped from reaching the row
function starNameEntry(event, index) {
	event.stopPropagation()

	nameDraft.preferredVariantIndex = index

	renderNameList()
}

// Takes one entry out of the copy being edited, the star and the selection follow their entries when the ones before them move up, the star falls back to the first entry when its own entry is removed, and removing the last entry leaves one blank entry
function removeNameEntry(event, index) {
	event.stopPropagation()
	syncNameDraftFromForm()

	nameDraft.variants.splice(index, 1)

	if(nameDraft.variants.length == 0){
		nameDraft.variants.push(getBlankName())
	}

	if(nameDraft.preferredVariantIndex == index){
		nameDraft.preferredVariantIndex = 0
	} else if(nameDraft.preferredVariantIndex > index){
		nameDraft.preferredVariantIndex -= 1
	}

	if(nameDraft.selectedIndex > index){
		nameDraft.selectedIndex -= 1
	}

	nameDraft.selectedIndex = Math.min(nameDraft.selectedIndex, nameDraft.variants.length - 1)

	fillNameForm(nameDraft.variants[nameDraft.selectedIndex])
	renderNameList()
}

// The empty entries are dropped, the star follows its entry and falls back to the first when its entry was dropped, a person who exists has to keep a name so the dialog stays open and says so, while a person who is being added and has no name entered is simply not created
function saveName(event) {
	event.preventDefault()
	syncNameDraftFromForm()

	let keptIndexes = nameDraft.variants
		.map((name, index) => index)
		.filter((index) => !isNameEmpty(nameDraft.variants[index]))

	if(keptIndexes.length == 0){
		if(isCreatingPerson){
			closeName()
		} else {
			showNameIssue(`A person needs a name`)
		}

		return
	}

	let names = {
		preferredVariantIndex : Math.max(keptIndexes.indexOf(nameDraft.preferredVariantIndex), 0),
		variants : keptIndexes.map((index) => nameDraft.variants[index])
	}

	if(isCreatingPerson){
		let ids = Object.keys(persons).map(Number)
		let newId = ids.length > 0 ? Math.max(...ids) + 1 : 1

		persons[ newId ] = {
			names : names
		}

		closeName()
		viewPerson(newId)
		console.log(persons, activeHistory)

		return
	}

	let person = persons[activeHistory.at(-1)]

	if(person){
		person.names = names
	}

	closeName()
	viewPerson()
}

// A gender is a list of entered values because sources disagree, each entry is { value, order, link, note } with null for every part that is not entered, value is one of the genderOptions, preferredVariantIndex is the starred entry that the person's page shows, and a person with no entered gender has no such property at all
let genderOptions = [
	{
		value : `male`,
		label : `Male`
	},
	{
		value : `female`,
		label : `Female`
	},
	{
		value : `non-binary`,
		label : `Non-Binary`
	}
]
let genderDraft = {
	variants : [],
	preferredVariantIndex : 0,
	selectedIndex : 0
}

function getBlankGender() {
	return {
		value : null,
		order : null,
		link : null,
		note : null
	}
}

function isGenderEmpty(gender) {
	return gender.value == null
}

// A value that is not one of the options, from a file that was edited by hand, is written as it is so nothing is hidden
function getGenderLabel(value) {
	return genderOptions.find((option) => option.value === value)?.label ?? `${value}`
}

// The entry that the person's page shows, which is the starred one, or null when nothing was entered
function getPreferredGender(person) {
	let field = person.gender

	if(!field || field.variants.length == 0){
		return null
	}

	return field.variants[field.preferredVariantIndex] ?? field.variants[0]
}

// The label is always there and a gender that was never entered shows a dash, clicking the line opens the dialog, which is set in index.html
function buildGenderHtml(person) {
	let gender = getPreferredGender(person)

	return `<span class="label">gender.</span>${gender ? escapeHtml(getGenderLabel(gender.value)) : `<span class="empty">\u2013</span>`}`
}

// The values are a row of small buttons, the chosen one is kept in a hidden box so the rest of the dialog can read it like any other box
function renderGenderValueChoices() {
	let chosenValue = document.getElementById(`genderValue`).value

	document.getElementById(`genderValueChoices`).innerHTML = genderOptions
		.map((option, index) => `<div class="choice${option.value === chosenValue ? ` selected` : ``}" onclick="chooseGenderValue(${index})">${option.label}</div>`)
		.join(``)
}

// Choosing the value that is already chosen clears it again
function chooseGenderValue(index) {
	let valueInput = document.getElementById(`genderValue`)

	valueInput.value = valueInput.value == genderOptions[index].value ? `` : genderOptions[index].value

	updateGenderDialog()
}

// The orders are a row of small buttons and the meaning of the chosen one is written underneath, the same as in the name dialog, the chosen one is kept in a hidden box
function renderGenderOrderChoices() {
	let chosenSourceOrder = getSourceOrder(Number(document.getElementById(`genderOrder`).value))

	document.getElementById(`genderOrderChoices`).innerHTML = sourceOrders
		.map((sourceOrder) => `<div class="choice${sourceOrder.order === chosenSourceOrder?.order ? ` selected` : ``}" onclick="chooseGenderOrder(${sourceOrder.order})">${sourceOrder.label}</div>`)
		.join(``)

	document.getElementById(`genderOrderDescription`).textContent = chosenSourceOrder ? `${chosenSourceOrder.name} \u00b7 ${chosenSourceOrder.description}` : `Choose how close this source is to the person.`
}

// Choosing the order that is already chosen clears it again
function chooseGenderOrder(order) {
	let orderInput = document.getElementById(`genderOrder`)

	orderInput.value = orderInput.value == `${order}` ? `` : order

	updateGenderDialog()
}

function readGenderForm() {
	return {
		value : document.getElementById(`genderValue`).value,
		order : document.getElementById(`genderOrder`).value,
		link : document.getElementById(`genderLink`).value.trim(),
		note : document.getElementById(`genderNote`).value.trim()
	}
}

// The boxes always show the selected entry, an empty entry is allowed while editing and is dropped when the dialog is saved
function fillGenderForm(gender) {
	document.getElementById(`genderValue`).value = gender?.value ?? ``
	document.getElementById(`genderOrder`).value = gender?.order ?? ``
	document.getElementById(`genderLink`).value = gender?.link ?? ``
	document.getElementById(`genderNote`).value = gender?.note ?? ``

	renderGenderValueChoices()
	renderGenderOrderChoices()
}

// Writes the boxes into the selected entry, a gender has no way to be impossible so this always works
function syncGenderDraftFromForm() {
	let form = readGenderForm()

	genderDraft.variants[genderDraft.selectedIndex] = {
		value : form.value == `` ? null : form.value,
		order : form.order == `` ? null : Number(form.order),
		link : form.link == `` ? null : form.link,
		note : form.note == `` ? null : form.note
	}
}

// The optional note and link go on a second line of the entry, a link is only clickable when it is a web address, and clicking it must not also select the entry
function buildGenderEntryHtml(gender, index) {
	let sourceOrder = getSourceOrder(gender.order)
	let isEmpty = isGenderEmpty(gender)
	let extraParts = []

	if(gender.note){
		extraParts.push(escapeHtml(gender.note))
	}

	if(gender.link){
		extraParts.push(isWebAddress(gender.link)
			? `<a href="${escapeHtml(gender.link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHtml(getLinkLabel(gender.link))}</a>`
			: escapeHtml(gender.link))
	}

	return `<div class="entry${index == genderDraft.selectedIndex ? ` selected` : ``}${isEmpty ? ` blank` : ``}" onclick="selectGenderEntry(${index})"><span class="star" onclick="starGenderEntry(event, ${index})">${index == genderDraft.preferredVariantIndex ? `\u2605` : `\u2606`}</span><span class="text">${isEmpty ? `New gender` : escapeHtml(getGenderLabel(gender.value))}</span><span class="meta">${sourceOrder ? `${sourceOrder.name} \u00b7 ${sourceOrder.label}` : `Source not set`}</span><span class="remove" onclick="removeGenderEntry(event, ${index})">remove</span>${extraParts.length > 0 ? `<span class="extra">${extraParts.join(` \u00b7 `)}</span>` : ``}</div>`
}

// The list of entered genders is only shown once there is something to list, the star marks the entry the page will show
function renderGenderList() {
	let isOnlyBlank = genderDraft.variants.length == 1 && isGenderEmpty(genderDraft.variants[0])

	document.getElementById(`genderList`).innerHTML = isOnlyBlank ? `` : `<div class="heading"><span>Entered genders</span><span class="action" onclick="addAnotherGender()">+ add another</span></div>${genderDraft.variants.map(buildGenderEntryHtml).join(``)}`
}

// A copy of the list for the dialog to work on, with one blank entry when there is nothing yet, and the selection on the starred entry
function getGenderDraft(field) {
	let variants = (field?.variants ?? []).map((gender) => ({ ...gender }))
	let preferredVariantIndex = field?.preferredVariantIndex ?? 0

	if(variants.length == 0){
		variants.push(getBlankGender())
	}

	return {
		variants : variants,
		preferredVariantIndex : preferredVariantIndex,
		selectedIndex : Math.min(preferredVariantIndex, variants.length - 1)
	}
}

// The dialog works on a copy of the list so Cancel throws every change away
function editGender() {
	let person = persons[activeHistory.at(-1)]

	if(!person){
		return
	}

	genderDraft = getGenderDraft(person.gender)

	fillGenderForm(genderDraft.variants[genderDraft.selectedIndex])
	renderGenderList()

	document.getElementById(`genderDialog`).showModal()
}

function closeGender() {
	document.getElementById(`genderDialog`).close()
}

// Every keystroke and every choice keeps the selected entry and the list up to date
function updateGenderDialog() {
	syncGenderDraftFromForm()
	renderGenderValueChoices()
	renderGenderOrderChoices()
	renderGenderList()
}

function selectGenderEntry(index) {
	syncGenderDraftFromForm()

	genderDraft.selectedIndex = index

	fillGenderForm(genderDraft.variants[index])
	renderGenderList()
}

// A new blank entry is added and selected, unless the selected entry is already blank
function addAnotherGender() {
	syncGenderDraftFromForm()

	if(!isGenderEmpty(genderDraft.variants[genderDraft.selectedIndex])){
		genderDraft.variants.push(getBlankGender())
		genderDraft.selectedIndex = genderDraft.variants.length - 1
	}

	fillGenderForm(genderDraft.variants[genderDraft.selectedIndex])
	renderGenderList()
}

// The star is inside a row that selects itself when clicked, so the click is stopped from reaching the row
function starGenderEntry(event, index) {
	event.stopPropagation()

	genderDraft.preferredVariantIndex = index

	renderGenderList()
}

// Takes one entry out of the copy being edited, the star and the selection follow their entries when the ones before them move up, the star falls back to the first entry when its own entry is removed, and removing the last entry leaves one blank entry
function removeGenderEntry(event, index) {
	event.stopPropagation()
	syncGenderDraftFromForm()

	genderDraft.variants.splice(index, 1)

	if(genderDraft.variants.length == 0){
		genderDraft.variants.push(getBlankGender())
	}

	if(genderDraft.preferredVariantIndex == index){
		genderDraft.preferredVariantIndex = 0
	} else if(genderDraft.preferredVariantIndex > index){
		genderDraft.preferredVariantIndex -= 1
	}

	if(genderDraft.selectedIndex > index){
		genderDraft.selectedIndex -= 1
	}

	genderDraft.selectedIndex = Math.min(genderDraft.selectedIndex, genderDraft.variants.length - 1)

	fillGenderForm(genderDraft.variants[genderDraft.selectedIndex])
	renderGenderList()
}

// The empty entries are dropped, which is how a gender is removed, the star follows its entry and falls back to the first when its entry was dropped, a list left empty removes the property, and viewPerson redraws the page and saves
function saveGender(event) {
	event.preventDefault()
	syncGenderDraftFromForm()

	let person = persons[activeHistory.at(-1)]

	if(!person){
		return
	}

	let keptIndexes = genderDraft.variants
		.map((gender, index) => index)
		.filter((index) => !isGenderEmpty(genderDraft.variants[index]))

	if(keptIndexes.length == 0){
		delete person.gender
	} else {
		person.gender = {
			preferredVariantIndex : Math.max(keptIndexes.indexOf(genderDraft.preferredVariantIndex), 0),
			variants : keptIndexes.map((index) => genderDraft.variants[index])
		}
	}

	closeGender()
	viewPerson()
}

// A gender in a file that was edited by hand, or written by an older version, is made safe, a gender that is not a list of sources is dropped, a source whose value is not one of the options is dropped, the order, the link and the note of the others are kept when they are valid, a gender with no valid source left is dropped, and the star stays on its own source, or goes to the first when that source was dropped or the star was out of bounds
function sanitizeGender(person) {
	if(!isPlainObject(person.gender) || !Array.isArray(person.gender.variants)){
		delete person.gender

		return
	}

	let starredVariant = person.gender.variants[person.gender.preferredVariantIndex]
	let cleanedVariants = []
	let preferredVariantIndex = 0

	for(let variant of person.gender.variants){
		if(!isPlainObject(variant) || !genderOptions.some((option) => option.value === variant.value)){
			continue
		}

		if(variant === starredVariant){
			preferredVariantIndex = cleanedVariants.length
		}

		cleanedVariants.push({
			value : variant.value,
			order : Number.isInteger(variant.order) && getSourceOrder(variant.order) ? variant.order : null,
			link : typeof variant.link == `string` && variant.link != `` ? variant.link : null,
			note : typeof variant.note == `string` && variant.note != `` ? variant.note : null
		})
	}

	if(cleanedVariants.length == 0){
		delete person.gender

		return
	}

	person.gender = {
		preferredVariantIndex : preferredVariantIndex,
		variants : cleanedVariants
	}
}

// Export and import move everything in one JSON file that can be read and edited by hand, it holds the people and the history
let exportSizeTimer = null

// The same text is used for the file and for the size, so the size shown is exactly the size of what would be written, tabs keep the file readable
function buildExportText() {
	return JSON.stringify(buildExportData(), null, `\t`)
}

// The exported time has a fixed length, so it never changes the size
function buildExportData() {
	return {
		version : 1,
		exportedAt : new Date().toISOString(),
		persons : persons,
		activeHistory : activeHistory
	}
}

// Decimal units, the same as the ones the system shows for files
function formatByteSize(bytes) {
	if(bytes < 1000){
		return `${bytes} B`
	}

	if(bytes < 1000000){
		return `${Math.round(bytes / 1000)} KB`
	}

	if(bytes < 1000000000){
		return `${(bytes / 1000000).toFixed(1)} MB`
	}

	return `${(bytes / 1000000000).toFixed(2)} GB`
}

// Saving happens often and the data has to be written out as text to be measured, so the size is only worked out a moment after the last change
function scheduleExportSizeUpdate() {
	clearTimeout(exportSizeTimer)

	exportSizeTimer = setTimeout(updateExportSize, 400)
}

// The size of the file Export would write, it is exact because it is the size of the very text that would be written, so it is worked out at once
function updateExportSize() {
	document.getElementById(`exportSize`).textContent = formatByteSize(new Blob([buildExportText()]).size)
}

// The browser is asked to save the file as a download, the temporary address is released afterwards, but not at once because some browsers start reading it a moment after the click
function downloadBlob(blob, fileName) {
	let url = URL.createObjectURL(blob)
	let link = document.createElement(`a`)

	link.href = url
	link.download = fileName

	link.click()

	setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function exportData() {
	let today = new Date()

	try {
		downloadBlob(new Blob([buildExportText()], { type : `application/json` }), `relation-index-${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, `0`)}-${`${today.getDate()}`.padStart(2, `0`)}.json`)

		markExported(today.toISOString())
	} catch(error) {
		window.alert(`The export could not be made. ${error.message}`)
	}
}

function isPlainObject(value) {
	return value !== null && typeof value == `object` && !Array.isArray(value)
}

// The checks are about the shape only, enough that the rest of the page can be trusted not to break on what is imported, the history is optional so older files are accepted, and so are the images of older files, which are ignored because the page no longer has images, older forms of names and dates are fine because they are converted afterwards
function validateImportData(data) {
	if(!isPlainObject(data)){
		throw new Error(`This file does not hold the data it should.`)
	}

	if(data.version !== 1){
		throw new Error(`This file was made by a different version of Relation Index (version ${data.version}).`)
	}

	if(!isPlainObject(data.persons)){
		throw new Error(`This file does not hold the people it should.`)
	}

	if(data.activeHistory !== undefined && !Array.isArray(data.activeHistory)){
		throw new Error(`The history in this file is not valid.`)
	}

	for(let [personId, person] of Object.entries(data.persons)){
		if(!/^\d+$/.test(personId) || !isPlainObject(person)){
			throw new Error(`Person ${personId} in this file is not valid.`)
		}
	}
}

// Names are compared without case, accents and extra spaces, so Zoe and ZOË match
function normalizeNameText(text) {
	return `${text ?? ``}`.normalize(`NFD`).replace(/[\u0300-\u036f]/g, ``).toLowerCase().replace(/\s+/g, ` `).trim()
}

// A person saved before names were lists still has firstName and lastName on the person itself, so both forms are understood
function getPersonNameEntries(person) {
	if(Array.isArray(person.names?.variants)){
		return person.names.variants
	}

	return person.firstName || person.lastName ? [person] : []
}

function getPersonNameKeys(person) {
	return new Set(getPersonNameEntries(person).map((entry) => normalizeNameText(`${entry.firstName ?? ``} ${entry.lastName ?? ``}`)).filter((key) => key != ``))
}

// Every year entered for a birth or a death, a date saved before dates were lists is one date on the person
function getPersonYears(person, kind) {
	let source = person[kind]
	let variants = Array.isArray(source?.variants) ? source.variants : source ? [source] : []

	return new Set(variants.map((variant) => variant.year).filter((year) => year != null))
}

// Two people are compared by their years only when both have one, if they share a year they agree, if not they disagree, and if either has none nothing can be said
function compareYears(existingYears, importedYears) {
	if(existingYears.size == 0 || importedYears.size == 0){
		return `unknown`
	}

	return [...importedYears].some((year) => existingYears.has(year)) ? `same` : `differs`
}

function describeCount(count, singular, plural) {
	return `${count} ${count == 1 ? singular : plural}`
}

// How long ago something happened, in words, a long time ago is a date, so it stays correct and short, and a clock that is a little off never gives a negative time
function formatTimeAgo(isoText, now = new Date()) {
	let date = new Date(isoText)
	let minutes = Math.floor((now - date) / 60000)

	if(isNaN(minutes)){
		return ``
	}

	if(minutes < 1){
		return `just now`
	}

	if(minutes < 60){
		return `${minutes} min ago`
	}

	if(minutes < 1440){
		let hours = Math.floor(minutes / 60)

		return `${hours} ${hours == 1 ? `hour` : `hours`} ago`
	}

	if(minutes < 2880){
		return `yesterday`
	}

	if(minutes < 43200){
		return `${Math.floor(minutes / 1440)} days ago`
	}

	return `on ${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

// Called after every save, a change is a save that altered the people, saving only the history of viewed people is not a change, the count is kept until the next export so it survives closing the page, the first change to an empty browser is also when the database counts as created, and every change is the time of the last change
function countChangesSinceLastSave() {
	let dataText = JSON.stringify(persons)

	if(savedDataText !== null && dataText !== savedDataText){
		exportState.changeCount += 1

		if(!exportState.loadedAt){
			exportState.loadedAt = new Date().toISOString()
			exportState.loadedSource = `created`
		}

		exportState.lastChangedAt = new Date().toISOString()

		localStorage.setItem(`exportState`, JSON.stringify(exportState))
	}

	savedDataText = dataText

	updateExportNote()
}

// The data as it is stored at the start, so the first save after loading is compared with it and not counted as a change
function rememberSavedData() {
	savedDataText = JSON.stringify(persons)
}

// Remembers that an export was made at this time, and starts counting again from nothing, where the database came from and when it last changed stay as they are
function markExported(exportedAt) {
	exportState = {
		...exportState,
		exportedAt : exportedAt,
		changeCount : 0
	}

	localStorage.setItem(`exportState`, JSON.stringify(exportState))

	updateExportNote()
}

// After an import the data is the file, so the last export is the date of the file if it has one, nothing has changed since, and the database was loaded just now
function markImported(exportedAt) {
	let fileDate = new Date(exportedAt)

	exportState = {
		exportedAt : isNaN(fileDate) ? null : fileDate.toISOString(),
		changeCount : 0,
		loadedAt : new Date().toISOString(),
		loadedSource : `imported`,
		lastChangedAt : null
	}

	localStorage.setItem(`exportState`, JSON.stringify(exportState))

	updateExportNote()
}

// The note under the Export button is always there, it says when the last export was and how many changes have been made since, it is grey until exportWarningChangeCount changes pile up, and then it turns the orange used for the other notices, because that much work would be lost if the browser lost its storage, an empty browser that never exported has nothing to say
function updateExportNote() {
	let noteElement = document.getElementById(`exportNote`)
	let hasData = Object.keys(persons).length > 0

	if(!hasData && !exportState.exportedAt){
		noteElement.textContent = ``

		return
	}

	noteElement.textContent = `${exportState.exportedAt ? `Last exported ${formatTimeAgo(exportState.exportedAt)}` : `Never exported`}${exportState.changeCount > 0 ? ` \u00b7 ${describeCount(exportState.changeCount, `change`, `changes`)}` : ``}`
	noteElement.className = exportState.changeCount >= exportWarningChangeCount ? `warning` : ``
}

// Import opens this dialog before anything else, it says what is in the browser now, where it came from and how long ago it last changed, so nobody replaces their data without seeing what would be lost, Export first is only offered when there is something to lose
function openImportDialog() {
	let personCount = Object.keys(persons).length
	let hasData = personCount > 0
	let rows = [
		`<div>${describeCount(personCount, `person`, `people`)} loaded in this browser</div>`
	]

	if(exportState.loadedAt && exportState.loadedSource == `imported`){
		rows.push(`<div class="fine">Database loaded ${formatTimeAgo(exportState.loadedAt)}</div>`)
	}

	if(exportState.loadedAt && exportState.loadedSource == `created`){
		rows.push(`<div class="fine">Database created ${formatTimeAgo(exportState.loadedAt)}</div>`)
	}

	if(exportState.lastChangedAt){
		rows.push(`<div class="fine">Last changed ${formatTimeAgo(exportState.lastChangedAt)}</div>`)
	}

	if(hasData){
		rows.push(`<div class="warning">Importing replaces everything that is here.</div>`)
	}

	document.getElementById(`importSummary`).innerHTML = rows.join(``)
	document.getElementById(`importIssue`).textContent = ``
	document.getElementById(`importExportFirst`).hidden = !hasData
	document.getElementById(`importChoose`).classList.toggle(`replace`, hasData)

	if(!document.getElementById(`importDialog`).open){
		document.getElementById(`importDialog`).showModal()
	}
}

function closeImportDialog() {
	document.getElementById(`importDialog`).close()
}

function chooseImportFile() {
	document.getElementById(`importInput`).click()
}

// The file is read and checked completely before anything in the page is changed, so a damaged file never does harm, a problem is shown in the dialog, which stays open so another file can be chosen
async function readImportFile(event) {
	let file = event.target.files[0]

	event.target.value = ``

	if(!file){
		return
	}

	try {
		let data

		try {
			data = JSON.parse(await file.text())
		} catch {
			throw new Error(`This file could not be read, it is not valid JSON, only a JSON file made by Export can be imported.`)
		}

		validateImportData(data)
		applyImport(data)
	} catch(error) {
		document.getElementById(`importIssue`).textContent = `\u26a0 ${error.message}`
	}
}

// Pictures were part of the page once, a person saved or exported then still carries the id and the crop of a profile picture, which mean nothing now
function removeLegacyImageData(person) {
	delete person.profileImageId
	delete person.profileCrop
}

// Replaces everything at once, if the browser has no room to save the new data the old data is put back, any images in the file are ignored
function applyImport(data) {
	let previousPersons = persons
	let previousHistory = activeHistory

	persons = data.persons
	activeHistory = (Array.isArray(data.activeHistory) ? data.activeHistory : []).map(Number).filter((personId) => persons[personId])

	Object.values(persons).forEach(migrateDates)
	Object.values(persons).forEach(migrateNames)
	Object.values(persons).forEach(sanitizeGender)
	Object.values(persons).forEach(removeLegacyImageData)
	Object.values(persons).forEach(sanitizeRelations)

	if(typeof rebuildPlainTextRelationIndex == `function`){
		rebuildPlainTextRelationIndex()
	}

	try {
		saveData()
	} catch {
		persons = previousPersons
		activeHistory = previousHistory

		saveData()

		throw new Error(`This browser has no room left to save the people.`)
	}

	markImported(data.exportedAt)
	rememberSavedData()

	closeImportDialog()
	viewPerson()
	scheduleExportSizeUpdate()
}

// Dates and names saved in their old forms are turned into lists, the profile picture ids and crops of the time when the page had pictures are dropped, and so are the pictures themselves, which were kept in localStorage and in an IndexedDB database, relations are made safe and the list of plain text relatives is built, and the person on screen before the refresh is shown again, nothing is shown when the history is empty, this is a function because relations.js is read after this file and calls it when it is ready, the first drawing of a person needs the relations
function startApp() {
	Object.values(persons).forEach(migrateDates)
	Object.values(persons).forEach(migrateNames)
	Object.values(persons).forEach(sanitizeGender)
	Object.values(persons).forEach(removeLegacyImageData)
	Object.values(persons).forEach(sanitizeRelations)
	localStorage.removeItem(`images`)
	indexedDB.deleteDatabase(`relationIndexImages`)
	rebuildPlainTextRelationIndex()
	rememberSavedData()
	viewPerson()
	scheduleExportSizeUpdate()
	updateExportNote()
	setInterval(updateExportNote, 60000)?.unref?.()
}
