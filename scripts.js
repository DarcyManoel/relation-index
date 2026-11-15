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
		updateRecentMenu()
		saveData()

		return
	}

	if(activeHistory.at(-1) !== id){
		activeHistory.push(id)
	}

	saveData()
	updateRecentMenu()

	document.getElementById(`name`).innerHTML = `<span class="rename" title="Rename" onclick="renamePerson()">${escapeHtml(person.firstName)} ${escapeHtml(person.lastName)}</span> <sup class="delete" title="Delete" onclick="deletePerson()">delete</sup>`
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

// The person on screen before the refresh is shown again, and nothing is shown when the history is empty
viewPerson()
