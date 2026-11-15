let persons = JSON.parse(localStorage.getItem(`persons`)) || {}

// The history is the list of viewed people with the active person last, it is saved as well so a refresh brings back the same person and deleting still falls back to the one viewed before, ids of people that no longer exist are dropped when it is loaded
let activeHistory = (JSON.parse(localStorage.getItem(`activeHistory`)) || []).filter((id) => persons[id])

// Everything that has to survive a refresh is written here
function saveData() {
	localStorage.setItem(`persons`, JSON.stringify(persons))
	localStorage.setItem(`activeHistory`, JSON.stringify(activeHistory))
}

// Names are typed by the user and end up inside innerHTML, so markup characters are escaped first
function escapeHtml(text) {
	return `${text}`
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`)
}

function addPerson() {
	let ids = Object.keys(persons).map(Number)
	let newId = ids.length > 0 ? Math.max(...ids) + 1 : 1

	persons[ newId ] = {
		firstName : `First`,
		lastName : `Last`
	}

	viewPerson(newId)
	console.log(persons, activeHistory)
}

// The window prompt is a confirm so nothing is removed unless OK is pressed, then every visit to that person is taken out of the history so viewPerson falls back to the person viewed before them
function deletePerson() {
	let id = activeHistory.at(-1)

	if(!persons[id] || !window.confirm(`Delete ${persons[id].firstName} ${persons[id].lastName}?`)){
		return
	}

	delete persons[id]
	activeHistory = activeHistory.filter((historyId) => historyId != id)

	viewPerson()
}

// Ids come back from localStorage as text so they are turned into numbers first, a person is only added to the history when they are not already the one on screen, and an id with no person clears the screen
function viewPerson(id = activeHistory.at(-1)) {
	id = Number(id)

	let person = persons[id]

	if(!person){
		document.getElementById(`name`).innerHTML = ``
		document.getElementById(`lifespan`).innerHTML = ``
		updateRecentMenu()
		saveData()

		return
	}

	if(activeHistory.at(-1) !== id){
		activeHistory.push(id)
	}

	saveData()
	updateRecentMenu()

	document.getElementById(`name`).innerHTML = `<span class="rename" onclick="renamePerson()">${escapeHtml(person.firstName)} ${escapeHtml(person.lastName)}</span> <sup class="delete" onclick="deletePerson()">delete</sup>`

	document.getElementById(`lifespan`).innerHTML = buildLifespanHtml(person)
}

// The menu lists the 10 most recent people other than the one on screen, newest first, each person only once
function updateRecentMenu() {
	let currentId = activeHistory.at(-1)
	let recentIds = [...new Set([...activeHistory].reverse())]
		.filter((id) => id !== currentId && persons[id])
		.slice(0, 10)

	document.getElementById(`recent`).innerHTML = recentIds
		.map((id) => `<div class="person" onclick="viewPerson(${id})">${escapeHtml(persons[id].firstName)} ${escapeHtml(persons[id].lastName)}</div>`)
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

// The dialog opens with the active person's current names already in the boxes so nothing has to be retyped
function renamePerson() {
	let person = persons[activeHistory.at(-1)]

	if(!person){
		return
	}

	document.getElementById(`renameFirstName`).value = person.firstName
	document.getElementById(`renameLastName`).value = person.lastName
	document.getElementById(`renameDialog`).showModal()
}

function closeRename() {
	document.getElementById(`renameDialog`).close()
}

// Either name can be left empty but not both, in that case the dialog stays open and nothing changes, and viewPerson is called afterwards so the nameplate is redrawn and everything is saved
function saveName(event) {
	event.preventDefault()

	let person = persons[activeHistory.at(-1)]
	let firstName = document.getElementById(`renameFirstName`).value.trim()
	let lastName = document.getElementById(`renameLastName`).value.trim()

	if(!person || (firstName == `` && lastName == ``)){
		return
	}

	person.firstName = firstName
	person.lastName = lastName

	closeRename()
	viewPerson()
}

// A birth or a death is a list of entered dates because sources disagree, each entry is { year, month, day, order, link, note } with null for every part that is not known, order saying how close the source is and link and note being optional, preferredVariantIndex is the starred entry that the person's page shows, and a person with no entered dates has no such property at all
let monthNames = [`Jan`, `Feb`, `Mar`, `Apr`, `May`, `Jun`, `Jul`, `Aug`, `Sep`, `Oct`, `Nov`, `Dec`]
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

// Dates saved in the old single form are turned into lists, the source order choices are filled in, and the person on screen before the refresh is shown again, nothing is shown when the history is empty
Object.values(persons).forEach(migrateDates)
viewPerson()
