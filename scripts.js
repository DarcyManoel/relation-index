let persons = JSON.parse(localStorage.getItem(`persons`)) || {}

// The history is the list of viewed people with the active person last, it is saved as well so a refresh brings back the same person and deleting still falls back to the one viewed before, ids of people that no longer exist are dropped when it is loaded
let activeHistory = (JSON.parse(localStorage.getItem(`activeHistory`)) || []).filter((id) => persons[id])

// The details of every image, keyed by image id, each is { widthPx, heightPx, date, note, people }, date is null or { day, month, year } with null for unknown parts, note is null or text, and people lists everyone in the image as { personId } for someone in the database or { text } for someone written in plain text, an image is shown in the gallery of every person it lists, the pixels are not here, they are in IndexedDB
let images = JSON.parse(localStorage.getItem(`images`)) || {}

// What the note under the Export button needs, when the last export was and how many changes were made since, it is kept in the browser so it survives closing the page, savedDataText is the people and images as they were at the last save, so the next save can tell whether anything changed
let exportState = JSON.parse(localStorage.getItem(`exportState`)) || {
	exportedAt : null,
	changeCount : 0
}
let savedDataText = null
let savedImageIds = new Set()
let exportWarningChangeCount = 20

// Everything that has to survive a refresh is written here
function saveData() {
	localStorage.setItem(`persons`, JSON.stringify(persons))
	localStorage.setItem(`images`, JSON.stringify(images))
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

	unlinkPersonFromImages(id)

	// A failed delete of the thumbnail only leaves a small file behind, so it is not worth stopping for
	deleteThumbnailBlob(id).catch(() => {})

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

		clearPhoto()
		clearGallery()

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

	document.getElementById(`name`).innerHTML = `<span class="rename" onclick="editName()">${escapeHtml(getNameLabel(person))}</span> <sup class="delete" onclick="deletePerson()">delete</sup>`

	document.getElementById(`lifespan`).innerHTML = buildLifespanHtml(person)
	document.getElementById(`header`).hidden = false

	renderPhoto(id)
	renderGallery(id)
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

// The fine text says what kind of thing the result is, only people can be found for now, and when the name that matched is not the starred one the name the page shows is added so the result is not a surprise
function buildSearchResultHtml(match, terms) {
	return `<div class="result" onclick="openSearchResult(${match.id})"><div class="text">${buildHighlightHtml(match.text, terms)}</div><div class="kind">Person${match.isPreferred ? `` : ` \u00b7 shown as ${escapeHtml(match.label)}`}</div></div>`
}

// A word of the search can be a date in several shapes and the parts of the image's date that it hits are returned so they can be highlighted, a date written with / . or - is read as day month year, or year month day when it starts with 4 digits, or month and year, or day and month, and every part that is written has to equal the same part of the image's date, a 4 digit number is a year, a 1 or 2 digit number is a day or a month, 14th is a day, and a month name or its start from 3 letters such as mar or march is a month
function getDateTermParts(term, date) {
	if(!date){
		return []
	}

	if(/^\d+([/.-]\d+){1,2}$/.test(term)){
		let numbers = term.split(/[/.-]/)
		let pairs

		if(numbers.length == 3){
			pairs = numbers[0].length == 4 ? [[`year`, numbers[0]], [`month`, numbers[1]], [`day`, numbers[2]]] : [[`day`, numbers[0]], [`month`, numbers[1]], [`year`, numbers[2]]]
		} else if(numbers[0].length == 4){
			pairs = [[`year`, numbers[0]], [`month`, numbers[1]]]
		} else if(numbers[1].length == 4){
			pairs = [[`month`, numbers[0]], [`year`, numbers[1]]]
		} else {
			pairs = [[`day`, numbers[0]], [`month`, numbers[1]]]
		}

		return pairs.every(([part, number]) => date[part] === Number(number)) ? pairs.map(([part]) => part) : []
	}

	if(/^\d{4}$/.test(term)){
		return date.year === Number(term) ? [`year`] : []
	}

	if(/^\d{1,2}(st|nd|rd|th)$/.test(term)){
		return date.day === parseInt(term, 10) ? [`day`] : []
	}

	if(/^\d{1,2}$/.test(term)){
		return [`day`, `month`].filter((part) => date[part] === Number(term))
	}

	if(/^[a-z]{3,}$/.test(term) && date.month != null){
		return monthFullNames[date.month - 1].toLowerCase().startsWith(term) ? [`month`] : []
	}

	return []
}

// Everyone listed in the image is searched by every name they have, so a person found by an old name still finds their images, and people written in plain text by what was typed
function getImageNameTexts(image) {
	return image.people.flatMap((entry) => entry.personId === undefined ? [entry.text] : (persons[entry.personId]?.names?.variants ?? []).map(formatNameText).filter((text) => text != ``))
}

// Every word has to be found in the date, the note or a name, and the words can be found in different places, so "beach 1950 anna" works, null means the image does not match
function matchImage(image, terms) {
	let noteText = (image.note ?? ``).toLowerCase()
	let nameTexts = getImageNameTexts(image).map((text) => text.toLowerCase())
	let dateParts = []

	for(let term of terms){
		let termDateParts = getDateTermParts(term, image.date)

		if(termDateParts.length == 0 && !noteText.includes(term) && !nameTexts.some((nameText) => nameText.includes(term))){
			return null
		}

		dateParts.push(...termDateParts)
	}

	return {
		dateParts : dateParts
	}
}

function findImageMatches(terms) {
	let matches = []

	for(let imageId of Object.keys(images).map(Number)){
		let match = matchImage(images[imageId], terms)

		if(match){
			matches.push({
				imageId : imageId,
				dateParts : match.dateParts
			})
		}
	}

	return matches.sort((firstMatch, secondMatch) => compareImagesNewestFirst(firstMatch.imageId, secondMatch.imageId))
}

// The date is written the way the page writes dates, with the parts that were hit by the search highlighted, and an image with no date says so
function buildImageDateHtml(date, dateParts) {
	if(!date){
		return `Undated`
	}

	let pieces = [
		date.day == null ? null : [`day`, getOrdinal(date.day)],
		date.month == null ? null : [`month`, monthNames[date.month - 1]],
		date.year == null ? (date.day == null && date.month == null ? null : [`year`, `?`]) : [`year`, date.year]
	]

	return pieces
		.filter((piece) => piece)
		.map(([part, text]) => dateParts.includes(part) ? `<mark>${text}</mark>` : `${text}`)
		.join(` `)
}

// Each person is written by the starred name, unless only another of their names contains a word of the search, then that name is shown so the highlight is visible
function getImageDisplayNames(image, terms) {
	let isTermFound = (text) => terms.some((term) => text.toLowerCase().includes(term))

	return image.people
		.map((entry) => {
			if(entry.personId === undefined){
				return entry.text
			}

			let person = persons[entry.personId]

			if(!person){
				return ``
			}

			let preferredText = getNameLabel(person)

			return isTermFound(preferredText) ? preferredText : person.names.variants.map(formatNameText).find(isTermFound) ?? preferredText
		})
		.filter((name) => name != ``)
}

// A note can be long so only a short piece of it is shown, starting a little before the first word that was found, or at the start when none was found
function buildNoteSnippetHtml(note, terms) {
	let flatNote = note.replace(/\s+/g, ` `).trim()
	let foundIndexes = terms.map((term) => flatNote.toLowerCase().indexOf(term)).filter((index) => index != -1)
	let startIndex = foundIndexes.length == 0 ? 0 : Math.max(0, Math.min(...foundIndexes) - 20)
	let snippetLength = 60

	return buildHighlightHtml(`${startIndex > 0 ? `\u2026` : ``}${flatNote.slice(startIndex, startIndex + snippetLength)}${startIndex + snippetLength < flatNote.length ? `\u2026` : ``}`, terms)
}

// The picture of an image result is loaded after the results are shown, the addresses made are kept so they can be released the next time the results are drawn, and searchRenderCount tells a late picture that the results it belonged to are gone, lastSearchImageIds is every image that matched, which the preview of a result steps through
let searchUrls = []
let searchRenderCount = 0
let lastSearchImageIds = []
let searchImageLimit = 20

async function loadResultPictures(imageIds, renderCount) {
	for(let imageId of imageIds){
		let blob = await getPreviewBlob(imageId)

		if(searchRenderCount !== renderCount){
			return
		}

		if(!blob){
			continue
		}

		let url = URL.createObjectURL(blob)

		searchUrls.push(url)

		document.getElementById(`result${imageId}`).src = url
	}
}

// The folder of orphaned images is found by typing the start of orphan, orphans or orphaned images, from 3 letters
function isOrphanFolderQuery(terms) {
	let text = terms.join(` `)

	return text.length >= 3 && (`orphaned images`.startsWith(text) || `orphans`.startsWith(text))
}

function buildFolderResultHtml(terms) {
	return `<div class="result" onclick="openOrphanFolder()"><div class="text">${buildHighlightHtml(`Orphaned images`, terms)}</div><div class="kind">Folder \u00b7 ${describeImageCount(getOrphanImageIds().length)}</div></div>`
}

// A picture, then the first line with the date and the people, and the fine text with the note, the picture is filled in later by loadResultPictures
function buildImageResultHtml(match, terms) {
	let image = images[match.imageId]
	let namesHtml = getImageDisplayNames(image, terms).map((name) => buildHighlightHtml(name, terms)).join(`, `)
	let noteHtml = image.note ? buildNoteSnippetHtml(image.note, terms) : ``

	return `<div class="result image" onclick="openImageResult(${match.imageId})"><img class="picture" id="result${match.imageId}" alt=""><div class="text">${buildImageDateHtml(image.date, match.dateParts)}${namesHtml == `` ? `` : ` \u00b7 ${namesHtml}`}</div><div class="kind">Image${noteHtml == `` ? `` : ` \u00b7 ${noteHtml}`}</div></div>`
}

// The preview opens over whatever page is showing and steps through all the images that matched, the list is taken before the search is closed because closing it clears the results
function openImageResult(imageId) {
	let matchedImageIds = lastSearchImageIds

	closeSearch()

	imageNavigationIds = matchedImageIds

	return openImage(imageId)
}

// Runs on every keystroke and when the box is focused again, an empty box lists nothing, the sections are the orphaned folder when its name is typed, then people, then images, at most searchImageLimit images are drawn because each one loads a picture, and the rest are counted
function updateSearch() {
	let terms = getSearchTerms()
	let resultsElement = document.getElementById(`results`)

	searchRenderCount += 1
	searchUrls.forEach((url) => URL.revokeObjectURL(url))

	searchUrls = []
	lastSearchImageIds = []

	if(terms.length == 0){
		resultsElement.innerHTML = ``

		return
	}

	let hasFolder = isOrphanFolderQuery(terms)
	let personMatches = findPersonMatches(terms)
	let imageMatches = findImageMatches(terms)
	let shownImageMatches = imageMatches.slice(0, searchImageLimit)

	lastSearchImageIds = imageMatches.map((match) => match.imageId)

	if(!hasFolder && personMatches.length == 0 && imageMatches.length == 0){
		resultsElement.innerHTML = `<div class="none">No results found</div>`

		return
	}

	resultsElement.innerHTML = [
		hasFolder ? `<div class="heading">Folders</div>${buildFolderResultHtml(terms)}` : ``,
		personMatches.length == 0 ? `` : `<div class="heading">People</div>${personMatches.map((match) => buildSearchResultHtml(match, terms)).join(``)}`,
		imageMatches.length == 0 ? `` : `<div class="heading">Images</div>${shownImageMatches.map((match) => buildImageResultHtml(match, terms)).join(``)}`,
		imageMatches.length > shownImageMatches.length ? `<div class="none">${imageMatches.length - shownImageMatches.length} more images match, narrow the search to see them</div>` : ``
	].join(``)

	loadResultPictures(shownImageMatches.map((match) => match.imageId), searchRenderCount)
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

// The pixels live in IndexedDB because localStorage holds only a few megabytes, it has three stores, originals keyed by image id hold the uploaded files exactly as they were so no quality is lost, previews keyed by image id hold a copy of each image with its longest side at previewSizePx for the gallery and the search results, and thumbnails keyed by person id hold the square crop shown as that person's profile picture, the two small kinds are kept apart so the page can show pictures without touching the big files and so the originals can later be exported out of the browser without breaking the page
let thumbnailSizePx = 384
let previewSizePx = 640
let imageDatabasePromise = null

// The profile image on screen is remembered as personId:imageId so showing the same person again does not reload it, and its address is kept so it can be released when it is replaced
let shownPhotoKey = null
let photoUrl = null

// The database is opened once and reused, a failed opening is forgotten so the next try starts again, version 2 added the previews store, so a database made by version 1 gets it when it is opened and keeps everything else
function openImageDatabase() {
	imageDatabasePromise ??= new Promise((resolve, reject) => {
		let request = indexedDB.open(`relationIndexImages`, 2)

		request.onupgradeneeded = () => {
			for(let storeName of [`originals`, `previews`, `thumbnails`]){
				if(!request.result.objectStoreNames.contains(storeName)){
					request.result.createObjectStore(storeName)
				}
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => {
			imageDatabasePromise = null

			reject(request.error)
		}
	})

	return imageDatabasePromise
}

// Resolves only when the whole transaction is complete, so a saved image is really saved, with the result of the request that the action returned, and rejects when the transaction is aborted
function runImageTransaction(storeNames, mode, action) {
	return openImageDatabase().then((database) => new Promise((resolve, reject) => {
		let transaction = database.transaction(storeNames, mode)
		let request = action(transaction)

		transaction.oncomplete = () => resolve(request?.result)
		transaction.onabort = () => reject(transaction.error)
	}))
}

// A new image is written to the originals and the previews in one transaction, so either both are saved or neither is, and a thumbnail is written in the same transaction when a person gets a new profile picture with it
function saveImageBlobs(blobs) {
	return runImageTransaction([`originals`, `previews`, `thumbnails`], `readwrite`, (transaction) => {
		let request = transaction.objectStore(`originals`).put(blobs.originalBlob, blobs.imageId)

		transaction.objectStore(`previews`).put(blobs.previewBlob, blobs.imageId)

		if(blobs.thumbnailBlob){
			request = transaction.objectStore(`thumbnails`).put(blobs.thumbnailBlob, blobs.personId)
		}

		return request
	})
}

function loadThumbnailBlob(personId) {
	return runImageTransaction(`thumbnails`, `readonly`, (transaction) => transaction.objectStore(`thumbnails`).get(personId))
}

function deleteThumbnailBlob(personId) {
	return runImageTransaction(`thumbnails`, `readwrite`, (transaction) => transaction.objectStore(`thumbnails`).delete(personId))
}

// A preview is only written when an image is first stored or when one is found missing, a thumbnail is written whenever a person gets a new profile picture
function savePreviewBlob(imageId, blob) {
	return runImageTransaction(`previews`, `readwrite`, (transaction) => transaction.objectStore(`previews`).put(blob, imageId))
}

function loadPreviewBlob(imageId) {
	return runImageTransaction(`previews`, `readonly`, (transaction) => transaction.objectStore(`previews`).get(imageId))
}

// Only an image that is deleted for good loses its pixels
function deleteImageBlobs(imageId) {
	return runImageTransaction([`originals`, `previews`], `readwrite`, (transaction) => {
		transaction.objectStore(`originals`).delete(imageId)

		return transaction.objectStore(`previews`).delete(imageId)
	})
}

// The smaller copy of an image used by the gallery and the search results, it is made from the original when it is missing, which is the case for images stored before previews existed, and if even that fails the original itself is used so something is always shown
async function getPreviewBlob(imageId) {
	let previewBlob = await loadPreviewBlob(imageId).catch(() => null)

	if(previewBlob){
		return previewBlob
	}

	let originalBlob = await loadOriginalBlob(imageId).catch(() => null)

	if(!originalBlob){
		return null
	}

	let madeBlob = null

	try {
		let bitmap = await createImageBitmap(originalBlob)

		madeBlob = await makeScaledBlob(bitmap, previewSizePx)

		bitmap.close()

		if(madeBlob){
			await savePreviewBlob(imageId, madeBlob)
		}
	} catch {
		madeBlob = null
	}

	return madeBlob ?? originalBlob
}

function loadOriginalBlob(imageId) {
	return runImageTransaction(`originals`, `readonly`, (transaction) => transaction.objectStore(`originals`).get(imageId))
}

function saveThumbnailBlob(personId, blob) {
	return runImageTransaction(`thumbnails`, `readwrite`, (transaction) => transaction.objectStore(`thumbnails`).put(blob, personId))
}

function getNextImageId() {
	return Math.max(0, ...Object.keys(images).map(Number)) + 1
}

// A new image lists only the person whose page it was uploaded on, the date and the note start empty
function buildNewImage(widthPx, heightPx, personId) {
	return {
		widthPx : widthPx,
		heightPx : heightPx,
		date : null,
		note : null,
		people : [
			{
				personId : personId
			}
		]
	}
}

// The image keeps its proportions with its longest side at longSidePx and is never made larger, a white background is painted first because JPEG has no transparency
function makeScaledBlob(bitmap, longSidePx) {
	let scale = Math.min(1, longSidePx / Math.max(bitmap.width, bitmap.height))
	let canvas = document.createElement(`canvas`)

	canvas.width = Math.round(bitmap.width * scale)
	canvas.height = Math.round(bitmap.height * scale)

	let drawing = canvas.getContext(`2d`)

	drawing.fillStyle = `white`
	drawing.fillRect(0, 0, canvas.width, canvas.height)
	drawing.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

	return new Promise((resolve) => canvas.toBlob(resolve, `image/jpeg`, .8))
}

function clampNumber(value, minimum, maximum) {
	return Math.min(Math.max(value, minimum), maximum)
}

// A profile crop is a square cut out of the image, sizeFraction is its side as a part of the shorter side of the image, so 1 is the largest square, and centerXFraction and centerYFraction are where its middle is as a part of the width and of the height, this default is the middle square, which is what the page showed before crops existed
function getDefaultCrop() {
	return {
		sizeFraction : 1,
		centerXFraction : .5,
		centerYFraction : .5
	}
}

// The crop turned into pixels of the image, moved inside the image if it would stick out
function getCropSquare(widthPx, heightPx, crop) {
	let sidePx = Math.min(widthPx, heightPx) * crop.sizeFraction

	return {
		sidePx : sidePx,
		leftPx : clampNumber(crop.centerXFraction * widthPx - sidePx / 2, 0, widthPx - sidePx),
		topPx : clampNumber(crop.centerYFraction * heightPx - sidePx / 2, 0, heightPx - sidePx)
	}
}

// The square on the page shows exactly this picture, it is at most thumbnailSizePx wide and is not made larger than the part cut out
function makeCropThumbnailBlob(bitmap, crop) {
	let square = getCropSquare(bitmap.width, bitmap.height, crop)
	let outputPx = Math.max(1, Math.min(thumbnailSizePx, Math.round(square.sidePx)))
	let canvas = document.createElement(`canvas`)

	canvas.width = outputPx
	canvas.height = outputPx

	let drawing = canvas.getContext(`2d`)

	drawing.fillStyle = `white`
	drawing.fillRect(0, 0, outputPx, outputPx)
	drawing.drawImage(bitmap, square.leftPx, square.topPx, square.sidePx, square.sidePx, 0, 0, outputPx, outputPx)

	return new Promise((resolve) => canvas.toBlob(resolve, `image/jpeg`, .8))
}

// Clicking the profile square opens a dialog where a rounded square is dragged over the picture and resized with a slider, the picture stays still and everything outside the square is darkened, the draft holds either the image already in the database or a file just chosen that is only stored when Save is pressed, so Cancel changes nothing, the crop is the one described at getDefaultCrop, and the smallest square is photoMinSizeFraction of the shorter side
let photoMinSizeFraction = .1
let shownCropUrl = null
let photoDraft = {
	imageId : null,
	file : null,
	widthPx : 0,
	heightPx : 0,
	crop : {
		sizeFraction : 1,
		centerXFraction : .5,
		centerYFraction : .5
	}
}
let photoDraftUrl = null
let photoDrag = null

function hasPhotoDraftImage() {
	return photoDraft.imageId != null || photoDraft.file != null
}

function releasePhotoUrl() {
	if(photoDraftUrl){
		URL.revokeObjectURL(photoDraftUrl)
	}

	photoDraftUrl = null
	shownCropUrl = null
}

// The picture is placed once at a fixed size, as large as fits the dialog, and never moves, a rounded square on top of it is the crop, it is placed with percentages of the picture, so no measuring is needed, and everything outside it is darkened by the frame's own shadow in the stylesheet, the picture is given to the page only when it changes so dragging does not reload it
function renderPhotoCropper() {
	let hasImage = hasPhotoDraftImage()
	let cropperElement = document.getElementById(`photoCropper`)
	let imageElement = document.getElementById(`photoCropImage`)
	let frameElement = document.getElementById(`photoCropFrame`)

	cropperElement.className = hasImage ? `cropper` : `cropper empty`
	frameElement.hidden = !hasImage
	imageElement.hidden = !hasImage || !photoDraftUrl

	document.getElementById(`photoSize`).disabled = !hasImage
	document.getElementById(`photoSize`).value = photoDraft.crop.sizeFraction

	if(!hasImage){
		cropperElement.style.aspectRatio = ``
		cropperElement.style.width = ``

		return
	}

	let sidePx = Math.min(photoDraft.widthPx, photoDraft.heightPx) * photoDraft.crop.sizeFraction

	cropperElement.style.aspectRatio = `${photoDraft.widthPx} / ${photoDraft.heightPx}`
	cropperElement.style.width = `min(100%, ${photoDraft.widthPx / photoDraft.heightPx * 60}dvh)`
	frameElement.style.width = `${sidePx / photoDraft.widthPx * 100}%`
	frameElement.style.height = `${sidePx / photoDraft.heightPx * 100}%`
	frameElement.style.left = `${(photoDraft.crop.centerXFraction - sidePx / 2 / photoDraft.widthPx) * 100}%`
	frameElement.style.top = `${(photoDraft.crop.centerYFraction - sidePx / 2 / photoDraft.heightPx) * 100}%`

	if(photoDraftUrl && photoDraftUrl !== shownCropUrl){
		imageElement.src = photoDraftUrl
		shownCropUrl = photoDraftUrl
	}
}

// Keeps the crop between the smallest size and the whole shorter side, and inside the image, a square that grows past an edge is pushed back in
function clampPhotoCrop() {
	let crop = photoDraft.crop

	crop.sizeFraction = clampNumber(crop.sizeFraction, photoMinSizeFraction, 1)

	let sidePx = Math.min(photoDraft.widthPx, photoDraft.heightPx) * crop.sizeFraction

	crop.centerXFraction = clampNumber(crop.centerXFraction, sidePx / 2 / photoDraft.widthPx, 1 - sidePx / 2 / photoDraft.widthPx)
	crop.centerYFraction = clampNumber(crop.centerYFraction, sidePx / 2 / photoDraft.heightPx, 1 - sidePx / 2 / photoDraft.heightPx)
}

// Pressing on the picture starts a drag, pressing outside the square first moves the square's middle to the pointer, the distance between the pointer and the middle is remembered and kept while dragging, so the square always follows the pointer exactly and does not drift when the pointer goes past an edge, an empty cropper is a button for choosing an image instead
function startPhotoDrag(event) {
	if(!hasPhotoDraftImage()){
		choosePhoto()

		return
	}

	let pictureBox = event.currentTarget.getBoundingClientRect()
	let pointerXFraction = (event.clientX - pictureBox.left) / pictureBox.width
	let pointerYFraction = (event.clientY - pictureBox.top) / pictureBox.height
	let halfSidePx = Math.min(photoDraft.widthPx, photoDraft.heightPx) * photoDraft.crop.sizeFraction / 2

	if(Math.abs(pointerXFraction - photoDraft.crop.centerXFraction) > halfSidePx / photoDraft.widthPx || Math.abs(pointerYFraction - photoDraft.crop.centerYFraction) > halfSidePx / photoDraft.heightPx){
		photoDraft.crop.centerXFraction = pointerXFraction
		photoDraft.crop.centerYFraction = pointerYFraction

		clampPhotoCrop()
		renderPhotoCropper()
	}

	photoDrag = {
		pointerId : event.pointerId,
		offsetXFraction : pointerXFraction - photoDraft.crop.centerXFraction,
		offsetYFraction : pointerYFraction - photoDraft.crop.centerYFraction
	}

	event.currentTarget.setPointerCapture(event.pointerId)
}

function movePhotoDrag(event) {
	if(!photoDrag || photoDrag.pointerId !== event.pointerId){
		return
	}

	let pictureBox = event.currentTarget.getBoundingClientRect()

	photoDraft.crop.centerXFraction = (event.clientX - pictureBox.left) / pictureBox.width - photoDrag.offsetXFraction
	photoDraft.crop.centerYFraction = (event.clientY - pictureBox.top) / pictureBox.height - photoDrag.offsetYFraction

	clampPhotoCrop()
	renderPhotoCropper()
}

function endPhotoDrag() {
	photoDrag = null
}

// The slider is the size of the square as a part of the shorter side of the picture, the middle of the square stays where it was
function updatePhotoSize() {
	photoDraft.crop.sizeFraction = Number(document.getElementById(`photoSize`).value)

	clampPhotoCrop()
	renderPhotoCropper()
}


// The dialog opens at once and the picture is loaded after, it is dropped if the dialog was closed meanwhile, the saved crop is used, or the middle square for a profile picture that has none
async function openPhoto() {
	let person = persons[activeHistory.at(-1)]

	if(!person){
		return
	}

	let imageId = images[person.profileImageId] ? person.profileImageId : null

	photoDraft = {
		imageId : imageId,
		file : null,
		widthPx : images[imageId]?.widthPx ?? 0,
		heightPx : images[imageId]?.heightPx ?? 0,
		crop : {
			...getDefaultCrop(),
			...(imageId == null ? {} : person.profileCrop)
		}
	}

	releasePhotoUrl()
	clearPhotoIssue()
	renderPhotoCropper()

	document.getElementById(`photoDialog`).showModal()

	if(imageId == null){
		return
	}

	let blob = (await loadOriginalBlob(imageId).catch(() => null)) ?? (await getPreviewBlob(imageId))

	if(photoDraft.imageId !== imageId || photoDraft.file || !blob){
		return
	}

	photoDraftUrl = URL.createObjectURL(blob)

	renderPhotoCropper()
}

function clearPhotoIssue() {
	document.getElementById(`photoIssue`).textContent = ``
}

function choosePhoto() {
	document.getElementById(`photoInput`).click()
}

// A chosen file replaces the draft and starts with the middle square, nothing is stored yet
async function choosePhotoFile(event) {
	let file = event.target.files[0]

	event.target.value = ``

	if(!file || !file.type.startsWith(`image/`)){
		return
	}

	try {
		let bitmap = await createImageBitmap(file)

		photoDraft = {
			imageId : null,
			file : file,
			widthPx : bitmap.width,
			heightPx : bitmap.height,
			crop : getDefaultCrop()
		}

		bitmap.close()
	} catch {
		document.getElementById(`photoIssue`).textContent = `\u26a0 That image could not be read.`

		return
	}

	clearPhotoIssue()
	releasePhotoUrl()

	photoDraftUrl = URL.createObjectURL(file)

	renderPhotoCropper()
}






function closePhoto() {
	document.getElementById(`photoDialog`).close()
}

// Runs whenever the dialog closes, including with the Escape key
function releasePhoto() {
	releasePhotoUrl()

	photoDrag = null
	photoDraft.imageId = null
	photoDraft.file = null
}

// A new file is stored as an image of the person together with the picture that is shown, an image already in the database only gets a new thumbnail from the new crop, nothing is changed unless everything worked
async function saveProfile(event) {
	event.preventDefault()

	let personId = activeHistory.at(-1)

	if(!persons[personId] || !hasPhotoDraftImage()){
		closePhoto()

		return
	}

	try {
		let imageId = photoDraft.imageId
		let sourceBlob = photoDraft.file ?? await loadOriginalBlob(imageId)

		if(!sourceBlob){
			throw new Error(`The image is missing`)
		}

		let bitmap = await createImageBitmap(sourceBlob)
		let thumbnailBlob = await makeCropThumbnailBlob(bitmap, photoDraft.crop)
		let previewBlob = photoDraft.file ? await makeScaledBlob(bitmap, previewSizePx) : null

		bitmap.close()

		if(!thumbnailBlob || (photoDraft.file && !previewBlob)){
			throw new Error(`A picture could not be made`)
		}

		if(photoDraft.file){
			imageId = getNextImageId()

			await saveImageBlobs({
				imageId : imageId,
				personId : personId,
				originalBlob : photoDraft.file,
				previewBlob : previewBlob,
				thumbnailBlob : thumbnailBlob
			})

			images[imageId] = buildNewImage(photoDraft.widthPx, photoDraft.heightPx, personId)
		} else {
			await saveThumbnailBlob(personId, thumbnailBlob)
		}

		persons[personId].profileImageId = imageId
		persons[personId].profileCrop = { ...photoDraft.crop }
	} catch {
		document.getElementById(`photoIssue`).textContent = `\u26a0 The profile picture could not be saved.`

		return
	}

	saveData()
	closePhoto()
	viewPerson()
}

// Shows the person's thumbnail in the square, a person with no profile image gets the empty square with a plus, the square is left alone when it already shows the right picture so nothing flashes, a new crop of the same image counts as a new picture, and a thumbnail that arrives after the person on screen has changed is thrown away
async function renderPhoto(personId) {
	let imageId = persons[personId]?.profileImageId ?? null
	let photoKey = imageId == null ? null : `${personId}:${imageId}:${JSON.stringify(persons[personId].profileCrop ?? null)}`

	document.getElementById(`photo`).className = imageId == null ? `empty` : ``

	if(photoKey === shownPhotoKey){
		return
	}

	clearPhoto()

	if(photoKey == null){
		return
	}

	shownPhotoKey = photoKey

	let thumbnailBlob = await loadThumbnailBlob(personId).catch(() => null)

	if(shownPhotoKey !== photoKey){
		return
	}

	if(!thumbnailBlob){
		shownPhotoKey = null

		return
	}

	photoUrl = URL.createObjectURL(thumbnailBlob)

	document.getElementById(`photo`).innerHTML = `<img src="${photoUrl}">`
}

function clearPhoto() {
	if(photoUrl){
		URL.revokeObjectURL(photoUrl)
	}

	photoUrl = null
	shownPhotoKey = null

	document.getElementById(`photo`).innerHTML = ``
}

// Deleting a person never deletes an image, the person is taken out of every image that lists them and written in as plain text instead so who was in the image is not lost, an image that no longer lists anyone in the database is an orphan and belongs in the orphaned folder, which is worked out from the list rather than stored
function unlinkPersonFromImages(personId) {
	let nameText = formatNameText(getPreferredName(persons[personId]))

	for(let image of Object.values(images)){
		image.people = image.people
			.map((entry) => entry.personId === personId ? (nameText == `` ? null : { text : nameText }) : entry)
			.filter((entry) => entry)
	}
}

// The gallery shows every image that lists the person, so a photo of two people appears on both pages, the tiles are laid out from the saved size before any pixels have loaded so nothing jumps, and the urls made for the pixels are kept so they can be released when the gallery is redrawn
let shownGalleryKey = null
let galleryUrls = []

// Dated images come first, newest first, a part that is not known counts as the earliest in its place, so an image with only a year comes after one with a month in that year, and an image with no year comes after those with a year, then the undated images, ties and the undated ones are put with the most recently added first
function compareImagesNewestFirst(firstImageId, secondImageId) {
	let firstDate = images[firstImageId].date
	let secondDate = images[secondImageId].date

	if(!firstDate || !secondDate){
		return (firstDate ? 0 : 1) - (secondDate ? 0 : 1) || secondImageId - firstImageId
	}

	return (secondDate.year ?? -1) - (firstDate.year ?? -1) || (secondDate.month ?? 0) - (firstDate.month ?? 0) || (secondDate.day ?? 0) - (firstDate.day ?? 0) || secondImageId - firstImageId
}

function getGalleryImageIds(personId) {
	return Object.keys(images)
		.map(Number)
		.filter((imageId) => images[imageId].people.some((entry) => entry.personId === personId))
		.sort(compareImagesNewestFirst)
}

// Dated images, a divider, then undated images, as tiles, every tile has the same height and takes its width from the proportions of its image so nothing moves when the pictures arrive, idPrefix keeps the tiles of the gallery and of the orphaned folder apart, and clickFunction is called with the image id when a tile is clicked
function buildTilesHtml(imageIds, idPrefix, clickFunction) {
	let datedCount = imageIds.filter((imageId) => images[imageId].date).length

	return `<div class="tiles">${imageIds.map((imageId, index) => `${index == datedCount && datedCount > 0 ? `<div class="divider"></div>` : ``}<div class="tile" style="aspect-ratio: ${images[imageId].widthPx} / ${images[imageId].heightPx}" onclick="${clickFunction}(${imageId})"><img id="${idPrefix}${imageId}" alt=""></div>`).join(``)}</div>`
}

// The previews are loaded one tile at a time into the tiles made by buildTilesHtml, urls collects the addresses made so they can be released later, and the loading stops as soon as isCurrent says the tiles on screen are no longer these
async function loadTilePictures(imageIds, idPrefix, urls, isCurrent) {
	for(let imageId of imageIds){
		let blob = await getPreviewBlob(imageId)

		if(!isCurrent()){
			return
		}

		if(!blob){
			continue
		}

		let url = URL.createObjectURL(blob)

		urls.push(url)

		document.getElementById(`${idPrefix}${imageId}`).src = url
	}
}

// Drawn again only when the person, the order of their images or the place of the divider changed
async function renderGallery(personId) {
	let imageIds = getGalleryImageIds(personId)
	let datedCount = imageIds.filter((imageId) => images[imageId].date).length
	let galleryKey = `${personId}:${imageIds.join(`,`)}:${datedCount}`

	if(galleryKey === shownGalleryKey){
		return
	}

	clearGallery()

	shownGalleryKey = galleryKey

	document.getElementById(`gallery`).innerHTML = `<div class="heading" onclick="chooseGalleryImages()"><span>Images</span><span class="action">+ add</span></div>${imageIds.length == 0 ? `` : buildTilesHtml(imageIds, `tile`, `openGalleryImage`)}`

	await loadTilePictures(imageIds, `tile`, galleryUrls, () => shownGalleryKey === galleryKey)
}

// The preview of an image from the gallery steps through the images of that gallery
function openGalleryImage(imageId) {
	imageNavigationIds = getGalleryImageIds(activeHistory.at(-1))

	return openImage(imageId)
}

// Several files can be given at once, by the file picker or by dropping them on the gallery, each one is checked, stored and listed on its own so one bad file does not stop the others, the details are saved once at the end and the page is redrawn once, and the number that failed is reported once
async function addGalleryFiles(fileList) {
	let files = [...fileList].filter((file) => file.type.startsWith(`image/`))
	let personId = activeHistory.at(-1)
	let failedCount = 0

	if(files.length == 0 || !persons[personId]){
		return
	}

	for(let file of files){
		try {
			let bitmap = await createImageBitmap(file)
			let imageWidthPx = bitmap.width
			let imageHeightPx = bitmap.height
			let previewBlob = await makeScaledBlob(bitmap, previewSizePx)

			bitmap.close()

			if(!previewBlob){
				throw new Error(`The preview could not be made`)
			}

			let imageId = getNextImageId()

			await saveImageBlobs({
				imageId : imageId,
				originalBlob : file,
				previewBlob : previewBlob
			})

			images[imageId] = buildNewImage(imageWidthPx, imageHeightPx, personId)
		} catch {
			failedCount += 1
		}
	}

	saveData()
	viewPerson()

	if(failedCount > 0){
		window.alert(`${failedCount} of ${files.length} images could not be read or saved.`)
	}
}

// The files are copied out of the input before it is reset, because resetting it empties the list
function uploadGalleryImages(event) {
	let files = [...event.target.files]

	event.target.value = ``

	return addGalleryFiles(files)
}

function dropGalleryFiles(event) {
	event.preventDefault()

	return addGalleryFiles(event.dataTransfer.files)
}

function clearGallery() {
	galleryUrls.forEach((url) => URL.revokeObjectURL(url))

	galleryUrls = []
	shownGalleryKey = null

	document.getElementById(`gallery`).innerHTML = ``
}

function chooseGalleryImages() {
	document.getElementById(`galleryInput`).click()
}

// The preview works on a copy of the list of people so Cancel throws every change away, the date and the note are read from their boxes when saving, and the url made for the pixels is released when the dialog closes
let imageDraft = {
	imageId : null,
	people : []
}
let previewUrl = null

function clearImageIssue() {
	document.getElementById(`imageIssue`).textContent = ``
}

function showImageIssue(issue) {
	document.getElementById(`imageIssue`).textContent = `\u26a0 ${issue}`
}

// A person in the database is written by the name they have now, so renaming them renames them in every image, and a person written in plain text is shown as typed
function buildImagePersonHtml(entry, index) {
	let isLinked = entry.personId !== undefined
	let label = isLinked ? (persons[entry.personId] ? getNameLabel(persons[entry.personId]) : `Unknown person`) : entry.text

	return `<div class="entry"><span class="text">${escapeHtml(label)}</span><span class="meta">${isLinked ? `Person` : `Plain text`}</span><span class="remove" onclick="removeImagePerson(${index})">remove</span></div>`
}

// An image that lists nobody in the database no longer appears in any gallery, so the dialog says so before it is saved
function renderImagePeople() {
	document.getElementById(`imagePeople`).innerHTML = imageDraft.people.map(buildImagePersonHtml).join(``)
	document.getElementById(`imageNotice`).textContent = imageDraft.people.some((entry) => entry.personId !== undefined) ? `` : `No person is listed, so this image will no longer appear in any gallery.`
}

// What is typed in the person box is matched against the names in the database the same way as the search box, people already listed are left out, and the last row always offers to keep the text as it was typed
function renderImageSuggestions() {
	let text = document.getElementById(`imagePersonName`).value.trim()
	let terms = splitSearchTerms(text)

	if(terms.length == 0){
		document.getElementById(`imageSuggestions`).innerHTML = ``

		return
	}

	let matches = findPersonMatches(terms)
		.filter((match) => !imageDraft.people.some((entry) => entry.personId === Number(match.id)))
		.slice(0, 5)

	document.getElementById(`imageSuggestions`).innerHTML = `${matches.map((match) => `<div class="entry" onclick="addImagePerson(${match.id})"><span class="text">${buildHighlightHtml(match.text, terms)}</span><span class="meta">Person</span></div>`).join(``)}<div class="entry" onclick="addImageText()"><span class="text">Add \u201c${escapeHtml(text)}\u201d as plain text</span></div>`
}

function finishAddingImagePerson() {
	document.getElementById(`imagePersonName`).value = ``

	renderImagePeople()
	renderImageSuggestions()

	document.getElementById(`imagePersonName`).focus()
}

function addImagePerson(personId) {
	if(!imageDraft.people.some((entry) => entry.personId === personId)){
		imageDraft.people.push({
			personId : personId
		})
	}

	finishAddingImagePerson()
}

// The same plain text is not added twice, whatever its case
function addImageText() {
	let text = document.getElementById(`imagePersonName`).value.trim()

	if(text != `` && !imageDraft.people.some((entry) => entry.text?.toLowerCase() === text.toLowerCase())){
		imageDraft.people.push({
			text : text
		})
	}

	finishAddingImagePerson()
}

function removeImagePerson(index) {
	imageDraft.people.splice(index, 1)

	renderImagePeople()
}

// Enter must not save the whole dialog from inside the person box, it takes the first row of the list instead, which is the best matching person or else the plain text
function handleImagePersonKey(event) {
	if(event.key != `Enter`){
		return
	}

	event.preventDefault()

	document.querySelector(`#imageSuggestions>.entry`)?.click()
}

function readImageDateForm() {
	return {
		day : document.getElementById(`imageDay`).value.trim(),
		month : document.getElementById(`imageMonth`).value.trim(),
		year : document.getElementById(`imageYear`).value.trim()
	}
}

// Every keystroke refreshes the matches and says at once when the date is impossible
function updateImageDialog() {
	let form = readImageDateForm()
	let issue = getDateIssue(form.day, form.month, form.year)

	if(issue == ``){
		clearImageIssue()
	} else {
		showImageIssue(issue)
	}

	renderImageSuggestions()
}

// The images the arrows of the preview step through, in order, set by whatever opened the preview, the gallery, the search results or the orphaned folder
let imageNavigationIds = []

// An image that lists nobody in the database belongs to nobody and is kept in the orphaned folder
function isImageOrphan(image) {
	return !image.people.some((entry) => entry.personId !== undefined)
}

// The arrows and the counter only show when there is somewhere to go, the first image has no previous and the last has no next
function renderImageNavigation() {
	let index = imageNavigationIds.indexOf(imageDraft.imageId)

	document.getElementById(`imagePrevious`).hidden = index <= 0
	document.getElementById(`imageNext`).hidden = index == -1 || index >= imageNavigationIds.length - 1
	document.getElementById(`imageCounter`).textContent = imageNavigationIds.length > 1 && index != -1 ? `${index + 1} of ${imageNavigationIds.length}` : ``
}

// The pixels are loaded after the dialog is open so it appears at once, the original is used and the preview copy only when the original is not there, they are dropped if the dialog was closed or switched to another image while they loaded, an image opened while the dialog is already open, by the arrows, reuses it
async function openImage(imageId) {
	let image = images[imageId]

	if(!image){
		return
	}

	if(!imageNavigationIds.includes(imageId)){
		imageNavigationIds = [imageId]
	}

	imageDraft = {
		imageId : imageId,
		people : image.people.map((entry) => ({ ...entry }))
	}

	document.getElementById(`imageDay`).value = image.date?.day ?? ``
	document.getElementById(`imageMonth`).value = image.date?.month ?? ``
	document.getElementById(`imageYear`).value = image.date?.year ?? ``
	document.getElementById(`imageNote`).value = image.note ?? ``
	document.getElementById(`imagePersonName`).value = ``

	// Making an image the profile image only makes sense for a person who is listed in it, and not when it already is the profile image
	document.getElementById(`imageProfile`).hidden = !image.people.some((entry) => entry.personId === activeHistory.at(-1)) || persons[activeHistory.at(-1)]?.profileImageId === imageId

	clearImageIssue()
	renderImagePeople()
	renderImageSuggestions()
	renderImageNavigation()

	if(!document.getElementById(`imageDialog`).open){
		document.getElementById(`imageDialog`).showModal()
	}

	let blob = (await loadOriginalBlob(imageId).catch(() => null)) ?? (await getPreviewBlob(imageId))

	if(imageDraft.imageId !== imageId || !blob){
		return
	}

	previewUrl = URL.createObjectURL(blob)

	document.getElementById(`imagePicture`).innerHTML = `<img src="${previewUrl}" alt="">`
}

// An empty date is stored as no date, an impossible one is reported and nothing is written, true means the image is saved, or that there was nothing to save
function commitImageDraft() {
	let image = images[imageDraft.imageId]

	if(!image){
		return true
	}

	let form = readImageDateForm()
	let issue = getDateIssue(form.day, form.month, form.year)

	if(issue != ``){
		showImageIssue(issue)

		return false
	}

	let note = document.getElementById(`imageNote`).value.trim()

	image.people = imageDraft.people
	image.date = form.day == `` && form.month == `` && form.year == `` ? null : {
		day : form.day == `` ? null : Number(form.day),
		month : form.month == `` ? null : Number(form.month),
		year : form.year == `` ? null : Number(form.year)
	}
	image.note = note == `` ? null : note

	saveData()

	return true
}

// The page behind the preview is redrawn so an image that was dated, or that no longer lists this person, moves or leaves their gallery, and the orphaned folder is redrawn when it is open
function refreshAfterImageChange() {
	viewPerson()
	renderOrphanFolder()
}

function saveImage(event) {
	event.preventDefault()

	if(!commitImageDraft()){
		return
	}

	closeImage()
	refreshAfterImageChange()
}

// Going to another image saves the one being left first, so what was typed is not lost, and stays where it is when the date is impossible
async function showAdjacentImage(step) {
	let index = imageNavigationIds.indexOf(imageDraft.imageId)
	let targetImageId = imageNavigationIds[index + step]

	if(index == -1 || targetImageId === undefined || !commitImageDraft()){
		return
	}

	refreshAfterImageChange()
	releaseImage()

	await openImage(targetImageId)
}

// The left and right arrow keys do the same as the buttons, except while typing in a box where they move the cursor
function handleImageKey(event) {
	if(![`ArrowLeft`, `ArrowRight`].includes(event.key) || [`INPUT`, `TEXTAREA`].includes(event.target.tagName)){
		return
	}

	event.preventDefault()

	showAdjacentImage(event.key == `ArrowLeft` ? -1 : 1)
}

// Makes the thumbnail from the stored original using the middle square, so any image in the gallery can become the profile image, the crop can be changed afterwards by clicking the square, this takes effect at once and does not wait for Save
async function setImageAsProfile() {
	let personId = activeHistory.at(-1)
	let imageId = imageDraft.imageId
	let crop = getDefaultCrop()

	if(!persons[personId] || imageId == null){
		return
	}

	try {
		let blob = await loadOriginalBlob(imageId)
		let bitmap = await createImageBitmap(blob)
		let thumbnailBlob = await makeCropThumbnailBlob(bitmap, crop)

		bitmap.close()

		if(!thumbnailBlob){
			throw new Error(`The thumbnail could not be made`)
		}

		await saveThumbnailBlob(personId, thumbnailBlob)

		persons[personId].profileImageId = imageId
		persons[personId].profileCrop = crop
	} catch {
		window.alert(`That image could not be made the profile image.`)

		return
	}

	saveData()
	viewPerson()

	document.getElementById(`imageProfile`).hidden = true
}

// Deletes the image for good, after asking, this is the only thing that ever removes an image, the original and the preview are gone and nothing can bring them back, the question says whose gallery it is in and who loses a profile picture, anyone who had it as their profile picture is left without one, and the page behind is redrawn
async function deleteImage() {
	let imageId = imageDraft.imageId
	let image = images[imageId]

	if(!image){
		return
	}

	let listedIds = image.people.map((entry) => entry.personId).filter((personId) => persons[personId])
	let ownerIds = Object.keys(persons).map(Number).filter((personId) => persons[personId].profileImageId === imageId)
	let listedText = listedIds.length == 0 ? `` : ` It is in the gallery of ${listedIds.map((personId) => getNameLabel(persons[personId])).join(`, `)}.`
	let ownerText = ownerIds.length == 0 ? `` : ` It is the profile picture of ${ownerIds.map((personId) => getNameLabel(persons[personId])).join(`, `)}, who will have no profile picture.`

	if(!window.confirm(`Delete this image permanently? This cannot be undone.${listedText}${ownerText}`)){
		return
	}

	try {
		await deleteImageBlobs(imageId)
	} catch {
		window.alert(`That image could not be deleted.`)

		return
	}

	for(let personId of ownerIds){
		delete persons[personId].profileImageId
		delete persons[personId].profileCrop

		deleteThumbnailBlob(personId).catch(() => {})
	}

	delete images[imageId]

	imageNavigationIds = imageNavigationIds.filter((navigationImageId) => navigationImageId != imageId)

	saveData()
	closeImage()
	refreshAfterImageChange()
}

function describeImageCount(count) {
	return `${count} ${count == 1 ? `image` : `images`}`
}

function getOrphanImageIds() {
	return Object.keys(images)
		.map(Number)
		.filter((imageId) => isImageOrphan(images[imageId]))
		.sort(compareImagesNewestFirst)
}

// The orphaned folder is a dialog with the tiles of every image that belongs to nobody, it is drawn again whenever an image changes while it is open, and the count is written out so an empty folder says so
let orphanUrls = []
let orphanRenderCount = 0

async function renderOrphanFolder() {
	if(!document.getElementById(`orphanDialog`).open){
		return
	}

	let imageIds = getOrphanImageIds()

	orphanRenderCount += 1

	let renderCount = orphanRenderCount

	orphanUrls.forEach((url) => URL.revokeObjectURL(url))

	orphanUrls = []

	document.getElementById(`orphanCount`).textContent = imageIds.length == 0 ? `There are no orphaned images.` : `${describeImageCount(imageIds.length)} that list no one in the database, kept here until a person is added to them or they are deleted.`
	document.getElementById(`orphanTiles`).innerHTML = imageIds.length == 0 ? `` : buildTilesHtml(imageIds, `orphanTile`, `openOrphanImage`)

	await loadTilePictures(imageIds, `orphanTile`, orphanUrls, () => orphanRenderCount === renderCount)
}

function openOrphanFolder() {
	closeSearch()

	document.getElementById(`orphanDialog`).showModal()

	renderOrphanFolder()
}

function openOrphanImage(imageId) {
	imageNavigationIds = getOrphanImageIds()

	return openImage(imageId)
}

function closeOrphanFolder() {
	document.getElementById(`orphanDialog`).close()
}

// Runs whenever the folder closes, so the pictures are released
function releaseOrphanFolder() {
	orphanRenderCount += 1

	orphanUrls.forEach((url) => URL.revokeObjectURL(url))

	orphanUrls = []

	document.getElementById(`orphanTiles`).innerHTML = ``
}

function closeImage() {
	document.getElementById(`imageDialog`).close()
}

// Runs whenever the dialog closes, including with the Escape key, so the pixels are always released
function releaseImage() {
	if(previewUrl){
		URL.revokeObjectURL(previewUrl)
	}

	previewUrl = null
	imageDraft.imageId = null

	document.getElementById(`imagePicture`).innerHTML = ``
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

// Export and import move everything in one zip file, data.json holds the people, the images and the history, and originals/ holds every original picture exactly as stored, named by date as described at buildOriginalFileNames, previews and thumbnails are left out because they can be made again from the originals, so the file stays small, zip is written and read here by hand so the page needs no library, only the STORE method (no compression) is used because photos are already compressed, so it is instant and the pictures are never copied into memory, every file is described twice, by a local header in front of its data and by an entry in the central directory at the end, and all numbers are little endian
let zipSignatures = {
	localHeader : 0x04034b50,
	centralEntry : 0x02014b50,
	endOfDirectory : 0x06054b50
}
let zipLimitBytes = 0xFFFFFFFF
let crcTable = null
let isExporting = false
let exportSizeTimer = null
let exportSizeRunId = 0

// The type a file name says, for a picture whose first bytes are not recognised here, an older export has no extension and then the type stays unknown
function getTypeFromExtension(name) {
	let extension = name.includes(`.`) ? name.split(`.`).at(-1).toLowerCase() : ``

	return Object.keys(imageTypeExtensions).find((type) => imageTypeExtensions[type] == extension) ?? ``
}

// The checksum every zip file entry carries, it is how a damaged file is noticed, the table is made on first use
function getCrcTable() {
	if(!crcTable){
		crcTable = new Uint32Array(256)

		for(let index = 0; index < 256; index++){
			let value = index

			for(let bit = 0; bit < 8; bit++){
				value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
			}

			crcTable[index] = value >>> 0
		}
	}

	return crcTable
}

function computeCrc32(bytes) {
	let table = getCrcTable()
	let crc = 0xFFFFFFFF

	for(let index = 0; index < bytes.length; index++){
		crc = table[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8)
	}

	return (crc ^ 0xFFFFFFFF) >>> 0
}

// Zip stores times as two 16 bit numbers, seconds are kept in steps of two and years count from 1980
function getDosDateTime(date) {
	return {
		time : (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		date : ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
	}
}

// Each entry is { name, blob }, the checksum needs the bytes of every file, so each one is read in turn and let go again, while the file itself goes into the zip as the blob it already is, so the zip is built from references and not from copies, file names are written as UTF-8 and the flag at bit 11 says so, a zip this simple cannot hold more than 65535 files or 4 GB, because that needs the zip64 extension, so that is reported instead of writing a file that cannot be read back
async function buildZipBlob(entries, reportProgress) {
	let encoder = new TextEncoder()
	let dosDateTime = getDosDateTime(new Date())
	let parts = []
	let centralParts = []
	let offsetBytes = 0

	if(entries.length > 0xFFFF){
		throw new Error(`There are too many files for a zip file.`)
	}

	for(let [index, entry] of entries.entries()){
		let nameBytes = encoder.encode(entry.name)
		let crc = computeCrc32(new Uint8Array(await entry.blob.arrayBuffer()))

		if(offsetBytes + 30 + nameBytes.length + entry.blob.size > zipLimitBytes){
			throw new Error(`The export is larger than 4 GB, which this zip writer cannot hold.`)
		}

		let localHeader = new DataView(new ArrayBuffer(30))

		localHeader.setUint32(0, zipSignatures.localHeader, true)
		localHeader.setUint16(4, 20, true)
		localHeader.setUint16(6, 0x0800, true)
		localHeader.setUint16(8, 0, true)
		localHeader.setUint16(10, dosDateTime.time, true)
		localHeader.setUint16(12, dosDateTime.date, true)
		localHeader.setUint32(14, crc, true)
		localHeader.setUint32(18, entry.blob.size, true)
		localHeader.setUint32(22, entry.blob.size, true)
		localHeader.setUint16(26, nameBytes.length, true)
		localHeader.setUint16(28, 0, true)

		let centralHeader = new DataView(new ArrayBuffer(46))

		centralHeader.setUint32(0, zipSignatures.centralEntry, true)
		centralHeader.setUint16(4, 20, true)
		centralHeader.setUint16(6, 20, true)
		centralHeader.setUint16(8, 0x0800, true)
		centralHeader.setUint16(10, 0, true)
		centralHeader.setUint16(12, dosDateTime.time, true)
		centralHeader.setUint16(14, dosDateTime.date, true)
		centralHeader.setUint32(16, crc, true)
		centralHeader.setUint32(20, entry.blob.size, true)
		centralHeader.setUint32(24, entry.blob.size, true)
		centralHeader.setUint16(28, nameBytes.length, true)
		centralHeader.setUint16(30, 0, true)
		centralHeader.setUint16(32, 0, true)
		centralHeader.setUint16(34, 0, true)
		centralHeader.setUint16(36, 0, true)
		centralHeader.setUint32(38, 0, true)
		centralHeader.setUint32(42, offsetBytes, true)

		parts.push(localHeader.buffer, nameBytes, entry.blob)
		centralParts.push(centralHeader.buffer, nameBytes)

		offsetBytes += 30 + nameBytes.length + entry.blob.size

		reportProgress?.(index + 1, entries.length)
	}

	let directoryBytes = centralParts.reduce((total, part) => total + part.byteLength, 0)

	if(offsetBytes + directoryBytes > zipLimitBytes){
		throw new Error(`The export is larger than 4 GB, which this zip writer cannot hold.`)
	}

	let endRecord = new DataView(new ArrayBuffer(22))

	endRecord.setUint32(0, zipSignatures.endOfDirectory, true)
	endRecord.setUint16(4, 0, true)
	endRecord.setUint16(6, 0, true)
	endRecord.setUint16(8, entries.length, true)
	endRecord.setUint16(10, entries.length, true)
	endRecord.setUint32(12, directoryBytes, true)
	endRecord.setUint32(16, offsetBytes, true)
	endRecord.setUint16(20, 0, true)

	return new Blob([...parts, ...centralParts, endRecord.buffer], { type : `application/zip` })
}

// The central directory is found from the end of the file, the end record is the last 22 bytes unless a comment follows it, so it is looked for backwards through the last 64 KB, and only the directory is read here, the files themselves are not touched until they are needed, a zip that needs zip64 is refused, because it was not written by Export
async function readZipEntries(file) {
	if(file.size < 22){
		throw new Error(`This file is too small to be a zip file.`)
	}

	let tailBytes = Math.min(file.size, 22 + 0xFFFF)
	let tail = new DataView(await file.slice(file.size - tailBytes, file.size).arrayBuffer())
	let endIndex = -1

	for(let index = tail.byteLength - 22; index >= 0; index--){
		if(tail.getUint32(index, true) == zipSignatures.endOfDirectory){
			endIndex = index

			break
		}
	}

	if(endIndex == -1){
		throw new Error(`This is not a zip file, or it is damaged.`)
	}

	let entryCount = tail.getUint16(endIndex + 10, true)
	let directoryBytes = tail.getUint32(endIndex + 12, true)
	let directoryOffset = tail.getUint32(endIndex + 16, true)

	if(entryCount == 0xFFFF || directoryBytes == 0xFFFFFFFF || directoryOffset == 0xFFFFFFFF){
		throw new Error(`This zip file uses zip64, which is not supported.`)
	}

	if(directoryOffset + directoryBytes > file.size){
		throw new Error(`This zip file is damaged, its directory is outside the file.`)
	}

	let directory = new DataView(await file.slice(directoryOffset, directoryOffset + directoryBytes).arrayBuffer())
	let entries = new Map()
	let position = 0

	for(let counter = 0; counter < entryCount; counter++){
		if(position + 46 > directory.byteLength || directory.getUint32(position, true) != zipSignatures.centralEntry){
			throw new Error(`This zip file is damaged, its directory cannot be read.`)
		}

		let nameLength = directory.getUint16(position + 28, true)
		let name = new TextDecoder().decode(new Uint8Array(directory.buffer, position + 46, nameLength))

		entries.set(name, {
			name : name,
			method : directory.getUint16(position + 10, true),
			crc : directory.getUint32(position + 16, true),
			sizeBytes : directory.getUint32(position + 24, true),
			headerOffset : directory.getUint32(position + 42, true)
		})

		position += 46 + nameLength + directory.getUint16(position + 30, true) + directory.getUint16(position + 32, true)
	}

	return entries
}

// The data of one entry as a blob that points into the file without copying it, the local header is read to find where the data starts because its name and extra field can be a different length from the ones in the directory, a compressed entry is refused because only files written by Export are expected
async function getZipEntryBlob(file, entry) {
	if(entry.method != 0){
		throw new Error(`${entry.name} is compressed, and only a zip file written by Export can be imported.`)
	}

	let header = new DataView(await file.slice(entry.headerOffset, entry.headerOffset + 30).arrayBuffer())

	if(header.byteLength < 30 || header.getUint32(0, true) != zipSignatures.localHeader){
		throw new Error(`This zip file is damaged, ${entry.name} cannot be found.`)
	}

	let startOffset = entry.headerOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true)

	if(startOffset + entry.sizeBytes > file.size){
		throw new Error(`This zip file is damaged, ${entry.name} is cut short.`)
	}

	return file.slice(startOffset, startOffset + entry.sizeBytes)
}

// The pictures in the zip have real file names with an extension, so they open straight from the zip in any file manager or viewer, the extension comes from the type the original was stored with, and a type that is not known here is worked out from the first bytes, a picture that is still not recognised gets .bin, because a wrong extension is worse than none
let imageTypeExtensions = {
	[`image/jpeg`] : `jpg`,
	[`image/png`] : `png`,
	[`image/gif`] : `gif`,
	[`image/webp`] : `webp`,
	[`image/heic`] : `heic`,
	[`image/heif`] : `heif`,
	[`image/avif`] : `avif`,
	[`image/bmp`] : `bmp`,
	[`image/tiff`] : `tif`,
	[`image/svg+xml`] : `svg`
}

// Zip does not remember what kind of file an original was, and the pictures need a type to be stored as they were, so it is read from the first bytes, the browser does not need it to show a picture, this only keeps what is stored the same as before
function guessImageType(bytes) {
	let readText = (from, to) => String.fromCharCode(...bytes.slice(from, to))

	if(bytes[0] == 0xFF && bytes[1] == 0xD8){
		return `image/jpeg`
	}

	if(bytes[0] == 0x89 && readText(1, 4) == `PNG`){
		return `image/png`
	}

	if(readText(0, 3) == `GIF`){
		return `image/gif`
	}

	if(readText(0, 4) == `RIFF` && readText(8, 12) == `WEBP`){
		return `image/webp`
	}

	if(readText(4, 8) == `ftyp`){
		if([`heic`, `heix`, `hevc`, `heim`, `heis`, `mif1`, `msf1`].includes(readText(8, 12))){
			return `image/heic`
		}

		if([`avif`, `avis`].includes(readText(8, 12))){
			return `image/avif`
		}
	}

	return ``
}

// The extension of an original, only the first bytes are read, and only when the stored type is missing or unknown
async function getOriginalExtension(blob) {
	let type = imageTypeExtensions[blob.type] ? blob.type : guessImageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))

	return imageTypeExtensions[type] ?? `bin`
}

// A date as YYYYMMDD with 00 for a part that is not known, so a year alone is 20210000, and files sort by date in any file manager
function buildDateFileKey(date) {
	return `${`${date.year ?? 0}`.padStart(4, `0`)}${`${date.month ?? 0}`.padStart(2, `0`)}${`${date.day ?? 0}`.padStart(2, `0`)}`
}

// The name of every original inside the zip, an image with a date is named by its date, a space and a number that counts the images with that same date from 1, as 20200510 1 and 20200510 2, and an image with no date is named by a number counting the undated images from 1, as 1 and 2, the numbers follow the image ids, so the same data always gives the same names, an original with no details in images counts as undated, these names say nothing about which image is which to the import, so data.json lists the name of every image, which is what the import goes by
async function buildOriginalFileNames(entries) {
	let counters = new Map()
	let names = new Map()

	for(let entry of [...entries].sort((firstEntry, secondEntry) => firstEntry.imageId - secondEntry.imageId)){
		let date = images[entry.imageId]?.date
		let key = date ? buildDateFileKey(date) : ``
		let number = (counters.get(key) ?? 0) + 1

		counters.set(key, number)
		names.set(entry.imageId, `originals/${key == `` ? `` : `${key} `}${number}.${await getOriginalExtension(entry.blob)}`)
	}

	return names
}

// Every original in the database with its image id, the blobs are only handles, so reading them costs nothing and their size is known without reading their content, runImageTransaction returns the result of the request that is handed back, so a small object whose result is worked out when the transaction completes is handed back, because two requests are needed here
function loadOriginalEntries() {
	return runImageTransaction(`originals`, `readonly`, (transaction) => {
		let store = transaction.objectStore(`originals`)
		let keysRequest = store.getAllKeys()
		let blobsRequest = store.getAll()

		return {
			get result() {
				return keysRequest.result.map((imageId, index) => ({
					imageId : imageId,
					blob : blobsRequest.result[index]
				}))
			}
		}
	})
}

function saveOriginalBlob(imageId, blob) {
	return runImageTransaction(`originals`, `readwrite`, (transaction) => transaction.objectStore(`originals`).put(blob, imageId))
}

// Replacing everything starts from empty stores, so no picture of the old data can end up under an id of the new data
function clearImageStores() {
	return runImageTransaction([`originals`, `previews`, `thumbnails`], `readwrite`, (transaction) => {
		transaction.objectStore(`originals`).clear()
		transaction.objectStore(`previews`).clear()

		return transaction.objectStore(`thumbnails`).clear()
	})
}

// The same data is used for the file and for the size estimate, so the estimate is the size of what would be written, files says which file in the zip holds the original of which image
function buildExportData(fileNames) {
	return {
		version : 1,
		exportedAt : new Date().toISOString(),
		persons : persons,
		images : images,
		activeHistory : activeHistory,
		files : Object.fromEntries(fileNames)
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

// The size of the zip Export would write, the data, every original and the zip headers, which are 30 and 46 bytes per file plus the file name twice and a 22 byte end record, it is shown in the tooltip of the Export button, it is only worked out a moment after the last change because saving happens often and every original has to be listed
function scheduleExportSizeUpdate() {
	clearTimeout(exportSizeTimer)

	exportSizeTimer = setTimeout(updateExportSize, 400)
}

async function updateExportSize() {
	exportSizeRunId += 1

	let runId = exportSizeRunId
	let encoder = new TextEncoder()

	try {
		let entries = await loadOriginalEntries()
		let fileNames = await buildOriginalFileNames(entries)
		let names = [`data.json`, ...fileNames.values()]
		let totalBytes = new Blob([JSON.stringify(buildExportData(fileNames))]).size
			+ entries.reduce((total, entry) => total + entry.blob.size, 0)
			+ names.reduce((total, name) => total + 76 + 2 * encoder.encode(name).length, 22)

		if(runId === exportSizeRunId){
			document.getElementById(`exportSize`).textContent = `~${formatByteSize(totalBytes)}`
		}
	} catch {
		if(runId === exportSizeRunId){
			document.getElementById(`exportSize`).textContent = ``
		}
	}
}

// The browser is asked to save the zip as a download, the temporary address is released afterwards, but not at once because some browsers start reading it a moment after the click
function downloadBlob(blob, fileName) {
	let url = URL.createObjectURL(blob)
	let link = document.createElement(`a`)

	link.href = url
	link.download = fileName

	link.click()

	setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// While the zip is being built the button is marked busy and a second click is ignored, so two zips are never built at the same time
async function exportData() {
	if(isExporting){
		return
	}

	isExporting = true

	document.getElementById(`export`).classList.add(`busy`)

	try {
		let originalEntries = await loadOriginalEntries()
		let fileNames = await buildOriginalFileNames(originalEntries)
		let entries = [
			{
				name : `data.json`,
				blob : new Blob([JSON.stringify(buildExportData(fileNames))], { type : `application/json` })
			},
			...originalEntries.map((entry) => ({
				name : fileNames.get(entry.imageId),
				blob : entry.blob
			}))
		]
		let today = new Date()

		downloadBlob(await buildZipBlob(entries), `relation-index-${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, `0`)}-${`${today.getDate()}`.padStart(2, `0`)}.zip`)

		markExported(today.toISOString())
	} catch(error) {
		window.alert(`The export could not be made. ${error.message}`)
	}

	isExporting = false

	document.getElementById(`export`).classList.remove(`busy`)
}

// What was read from the zip file and checked, nothing in the page is changed until this is complete, so a damaged file never does harm, originals maps each image id to its picture, and missingImageIds are images the file lists but holds no picture for, which can be, for example, when the browser lost its pictures before the export was made
let importPlan = null
let importCheckToken = 0
let isImporting = false

function isPlainObject(value) {
	return value !== null && typeof value == `object` && !Array.isArray(value)
}

// The checks are about the shape only, enough that the rest of the page can be trusted not to break on what is imported, older forms of names and dates are fine because they are converted afterwards
function validateImportData(data) {
	if(!isPlainObject(data)){
		throw new Error(`data.json does not hold the data it should.`)
	}

	if(data.version !== 1){
		throw new Error(`This file was made by a different version of Relation Index (version ${data.version}).`)
	}

	if(!isPlainObject(data.persons) || !isPlainObject(data.images)){
		throw new Error(`data.json does not hold the people and images it should.`)
	}

	for(let [personId, person] of Object.entries(data.persons)){
		if(!/^\d+$/.test(personId) || !isPlainObject(person)){
			throw new Error(`Person ${personId} in data.json is not valid.`)
		}
	}

	if(data.files !== undefined && (!isPlainObject(data.files) || !Object.entries(data.files).every(([imageId, name]) => /^\d+$/.test(imageId) && typeof name == `string`))){
		throw new Error(`The list of picture files in data.json is not valid.`)
	}

	for(let [imageId, image] of Object.entries(data.images)){
		if(!/^\d+$/.test(imageId) || !isPlainObject(image) || !Array.isArray(image.people) || !image.people.every(isPlainObject) || !(image.widthPx > 0) || !(image.heightPx > 0)){
			throw new Error(`Image ${imageId} in data.json is not valid.`)
		}
	}
}

// Reads the whole file once, the directory, data.json and the checksum of every original, nothing is stored, the pictures are only pointed at, so this can be done for a file of many gigabytes, a null result means the check was cancelled
async function buildImportPlan(file, reportProgress, isCancelled) {
	let entries = await readZipEntries(file)
	let dataEntry = entries.get(`data.json`)

	if(!dataEntry){
		throw new Error(`This is not a Relation Index export, data.json is missing.`)
	}

	let dataBytes = new Uint8Array(await (await getZipEntryBlob(file, dataEntry)).arrayBuffer())

	if(computeCrc32(dataBytes) !== dataEntry.crc){
		throw new Error(`data.json is damaged, its checksum does not match.`)
	}

	let data

	try {
		data = JSON.parse(new TextDecoder().decode(dataBytes))
	} catch {
		throw new Error(`data.json could not be read, it is not valid JSON.`)
	}

	validateImportData(data)

	let originals = new Map()
	let fileNames = new Map()

	// data.json says which file holds which image, an export made before that list existed has files called originals/{imageId} with or without an extension
	if(data.files){
		Object.entries(data.files).forEach(([imageId, name]) => fileNames.set(Number(imageId), name))
	} else {
		[...entries.values()]
			.filter((entry) => /^originals\/\d+(\.[A-Za-z0-9]+)?$/.test(entry.name))
			.forEach((entry) => fileNames.set(parseInt(entry.name.split(`/`)[1], 10), entry.name))
	}

	let listedFiles = [...fileNames.entries()].filter(([imageId, name]) => entries.has(name))

	for(let [index, [imageId, name]] of listedFiles.entries()){
		if(isCancelled()){
			return null
		}

		reportProgress(index + 1, listedFiles.length)

		let entry = entries.get(name)
		let blob = await getZipEntryBlob(file, entry)
		let bytes = new Uint8Array(await blob.arrayBuffer())

		if(computeCrc32(bytes) !== entry.crc){
			throw new Error(`${entry.name} is damaged, its checksum does not match.`)
		}

		originals.set(imageId, blob.slice(0, blob.size, guessImageType(bytes) || getTypeFromExtension(entry.name)))
	}

	return {
		persons : data.persons,
		images : data.images,
		activeHistory : Array.isArray(data.activeHistory) ? data.activeHistory : [],
		exportedAt : data.exportedAt,
		originals : originals,
		missingImageIds : Object.keys(data.images).map(Number).filter((imageId) => !originals.has(imageId))
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

function getImportedPersonLabel(person) {
	let nameEntry = Array.isArray(person.names?.variants) ? (person.names.variants[person.names.preferredVariantIndex] ?? person.names.variants[0]) : person
	let text = formatNameText(nameEntry ?? {})

	return text == `` ? `Unnamed` : text
}

// A person in the file is a possible duplicate when any of their names matches any name of a person already here, the birth and death years are then compared to say how likely it is, this only warns, Merge never joins people, because two people can share a name
function findImportConflicts(importedPersons) {
	let existingByKey = new Map()
	let conflicts = []

	for(let [personId, person] of Object.entries(persons)){
		for(let key of getPersonNameKeys(person)){
			existingByKey.set(key, [...(existingByKey.get(key) ?? []), Number(personId)])
		}
	}

	for(let [importedId, importedPerson] of Object.entries(importedPersons)){
		let existingIds = [...new Set([...getPersonNameKeys(importedPerson)].flatMap((key) => existingByKey.get(key) ?? []))]

		if(existingIds.length == 0){
			continue
		}

		let comparisons = existingIds.map((existingId) => ({
			existingId : existingId,
			birth : compareYears(getPersonYears(persons[existingId], `birth`), getPersonYears(importedPerson, `birth`)),
			death : compareYears(getPersonYears(persons[existingId], `death`), getPersonYears(importedPerson, `death`))
		}))
		let bestComparison = comparisons.find((comparison) => comparison.birth != `differs` && comparison.death != `differs`) ?? comparisons[0]

		conflicts.push({
			importedId : Number(importedId),
			existingId : bestComparison.existingId,
			label : getImportedPersonLabel(importedPerson),
			birth : bestComparison.birth,
			death : bestComparison.death
		})
	}

	return conflicts
}

function describeConflict(conflict) {
	let notes = []

	for(let [kind, result] of [[`birth`, conflict.birth], [`death`, conflict.death]]){
		if(result == `same`){
			notes.push(`same ${kind} year`)
		} else if(result == `differs`){
			notes.push(`${kind} year differs`)
		}
	}

	return `${conflict.label} \u2014 ${notes.length == 0 ? `no birth or death year to compare` : notes.join(`, `)}`
}

function describeCount(count, singular, plural) {
	return `${count} ${count == 1 ? singular : plural}`
}

// What the dialog shows when the browser already holds data, the counts on both sides, the possible duplicates with a few examples, and what each button does
function buildImportSummaryHtml(plan, conflicts) {
	let exportedDate = new Date(plan.exportedAt)
	let rows = [
		`<div>In the file: ${describeCount(Object.keys(plan.persons).length, `person`, `people`)}, ${describeCount(Object.keys(plan.images).length, `image`, `images`)}</div>`,
		`<div>In this browser: ${describeCount(Object.keys(persons).length, `person`, `people`)}, ${describeCount(Object.keys(images).length, `image`, `images`)}</div>`
	]

	if(!isNaN(exportedDate)){
		rows.push(`<div class="fine">The file was made on ${exportedDate.getDate()} ${monthNames[exportedDate.getMonth()]} ${exportedDate.getFullYear()}</div>`)
	}

	if(conflicts.length == 0){
		rows.push(`<div>No person in the file has the same name as a person here.</div>`)
	} else {
		rows.push(`<div>${describeCount(conflicts.length, `person in the file has`, `people in the file have`)} the same name as ${conflicts.length == 1 ? `a person` : `people`} here:</div>`)

		conflicts.slice(0, 3).forEach((conflict) => rows.push(`<div class="fine">${escapeHtml(describeConflict(conflict))}</div>`))

		if(conflicts.length > 3){
			rows.push(`<div class="fine">and ${conflicts.length - 3} more</div>`)
		}
	}

	rows.push(`<div class="fine">${conflicts.length == 0 ? `Merge adds everything in the file to what is here and changes nothing that is here.` : `Merge adds the rest of the file to what is here, and asks you what to do about each person who has the same name as someone here.`}</div>`)
	rows.push(`<div class="warning">Replace deletes everything that is here first.</div>`)

	return rows.join(``)
}

// How long ago the last export was, in words, a long time ago is a date, so it stays correct and short, and a clock that is a little off never gives a negative time
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
		return `${Math.floor(minutes / 60)} h ago`
	}

	if(minutes < 2880){
		return `yesterday`
	}

	if(minutes < 43200){
		return `${Math.floor(minutes / 1440)} days ago`
	}

	return `on ${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

// Called after every save, a change is a save that altered the people or the images, saving only the history of viewed people is not a change, and each new image counts as a change of its own, because a photo cannot be typed in again, so adding ten photos counts as eleven, the count is kept until the next export so it survives closing the page
function countChangesSinceLastSave() {
	let dataText = JSON.stringify([persons, images])
	let imageIds = new Set(Object.keys(images))

	if(savedDataText !== null && dataText !== savedDataText){
		exportState.changeCount += 1 + [...imageIds].filter((imageId) => !savedImageIds.has(imageId)).length

		localStorage.setItem(`exportState`, JSON.stringify(exportState))
	}

	savedDataText = dataText
	savedImageIds = imageIds

	updateExportNote()
}

// The data as it is stored at the start, so the first save after loading is compared with it and not counted as a change
function rememberSavedData() {
	savedDataText = JSON.stringify([persons, images])
	savedImageIds = new Set(Object.keys(images))
}

// Remembers that an export was made at this time, or that the data now matches a file, and starts counting again from nothing
function markExported(exportedAt) {
	exportState = {
		exportedAt : exportedAt,
		changeCount : 0
	}

	localStorage.setItem(`exportState`, JSON.stringify(exportState))

	updateExportNote()
}

// The note under the Export button is always there, it says when the last export was and how many changes have been made since, it is grey until exportWarningChangeCount changes pile up, and then it turns the orange used for the other notices, because that much work would be lost if the browser lost its storage, an empty browser that never exported has nothing to say
function updateExportNote() {
	let noteElement = document.getElementById(`exportNote`)
	let hasData = Object.keys(persons).length > 0 || Object.keys(images).length > 0

	if(!hasData && !exportState.exportedAt){
		noteElement.textContent = ``

		return
	}

	noteElement.textContent = `${exportState.exportedAt ? `Last exported ${formatTimeAgo(exportState.exportedAt)}` : `Never exported`}${exportState.changeCount > 0 ? ` \u00b7 ${describeCount(exportState.changeCount, `change`, `changes`)}` : ``}`
	noteElement.className = exportState.changeCount >= exportWarningChangeCount ? `warning` : ``
}

// A person from the file is a copy of someone already here when the names match, Merge asks what to do about each one, the way the Finder asks about a file that already exists, the choices are to keep both, which adds the person from the file as a new person, to replace, which puts the person from the file in the place of the one here, so the details and the profile picture of the file win and everything else that points at that person still does, and to keep the current one, which changes nothing about the person but still adds the images of the one in the file to them, so no image is lost, whatever is chosen, the images of the file are always added and never overwrite an image here, the answers are kept per person of the file in importResolutions, and Apply to all uses one answer for the rest
let importConflicts = []
let importResolutions = {}
let importConflictIndex = 0
let importCompareUrls = []
let importCompareToken = 0
let compareGalleryCount = 4

// What is shown about a person on each side, a line for each so the two sides can be compared line by line, a person is brought to the newest form first, so a person from an old file reads the same as one made today
function buildPersonComparisonRows(person, imageCount) {
	let born = getPreferredDate(person, `birth`)
	let died = getDeathDate(person)

	return [
		{
			label : `Name`,
			text : getNameLabel(person)
		},
		{
			label : `Born`,
			text : born ? (formatDateText(born) || `?`) : `\u2014`
		},
		{
			label : `Died`,
			text : died ? (formatDateText(died) || `Deceased`) : `\u2014`
		},
		{
			label : `Other names`,
			text : `${Math.max(0, (person.names?.variants ?? []).length - 1)}`
		},
		{
			label : `Images`,
			text : `${imageCount}`
		}
	]
}

// Two columns, here and in the file, a picture and then a line for each detail, a line that is different on the two sides is bold, so what differs can be seen at a glance
function buildConflictCompareHtml(existingPerson, importedPerson, existingImageCount, importedImageCount) {
	let existingRows = buildPersonComparisonRows(existingPerson, existingImageCount)
	let importedRows = buildPersonComparisonRows(importedPerson, importedImageCount)

	return `<div class="head">Here</div><div class="head">In the file</div><div class="picture"><img id="compareHereImage" alt=""></div><div class="picture"><img id="compareFileImage" alt=""></div>${existingRows.map((existingRow, index) => {
		let importedRow = importedRows[index]
		let differs = existingRow.text != importedRow.text ? ` differs` : ``

		return `<div class="cell${differs}"><span class="label">${existingRow.label}</span>${escapeHtml(existingRow.text)}</div><div class="cell${differs}"><span class="label">${importedRow.label}</span>${escapeHtml(importedRow.text)}</div>`
	}).join(``)}<div class="strip" id="compareHereGallery"></div><div class="strip" id="compareFileGallery"></div>`
}

// The pictures of each side, so the two people can be compared by eye, the profile picture, and then the first few images of the gallery, the ones here are their stored previews, and the ones in the file are made small from the originals in the file, because the file holds no previews, the profile picture of the file is cut with its saved crop, a picture that arrives after the dialog moved on to the next conflict is dropped, and one that cannot be read is left out, the details are still there to compare
async function loadImportComparePictures(conflict, importedPerson, token) {
	let showPicture = (elementId, blob, isInStrip) => {
		if(token !== importCompareToken || !blob){
			return
		}

		let url = URL.createObjectURL(blob)

		importCompareUrls.push(url)

		if(isInStrip){
			document.getElementById(elementId).innerHTML += `<img src="${url}" alt="">`
		} else {
			document.getElementById(elementId).src = url
		}
	}
	let makeSmallBlob = async (originalBlob, crop) => {
		try {
			let bitmap = await createImageBitmap(originalBlob)
			let smallBlob = crop ? await makeCropThumbnailBlob(bitmap, crop) : await makeScaledBlob(bitmap, 160)

			bitmap.close()

			return smallBlob
		} catch {
			return null
		}
	}

	if(persons[conflict.existingId]?.profileImageId != null){
		showPicture(`compareHereImage`, await loadThumbnailBlob(conflict.existingId).catch(() => null))
	}

	let profileBlob = importPlan?.originals.get(Number(importedPerson.profileImageId))

	if(profileBlob){
		showPicture(`compareFileImage`, await makeSmallBlob(profileBlob, {
			...getDefaultCrop(),
			...importedPerson.profileCrop
		}))
	}

	for(let imageId of getGalleryImageIds(conflict.existingId).slice(0, compareGalleryCount)){
		showPicture(`compareHereGallery`, await getPreviewBlob(imageId), true)
	}

	let importedImageIds = Object.keys(importPlan?.images ?? {})
		.map(Number)
		.filter((imageId) => importPlan.images[imageId].people.some((entry) => entry.personId === conflict.importedId))
		.slice(0, compareGalleryCount)

	for(let imageId of importedImageIds){
		let originalBlob = importPlan?.originals.get(imageId)

		if(originalBlob){
			showPicture(`compareFileGallery`, await makeSmallBlob(originalBlob), true)
		}
	}
}

function releaseImportCompare() {
	importCompareToken += 1

	importCompareUrls.forEach((url) => URL.revokeObjectURL(url))

	importCompareUrls = []
}

async function renderImportConflict() {
	let conflict = importConflicts[importConflictIndex]
	let importedPerson = prepareImportedPerson(importPlan.persons[conflict.importedId])
	let importedImageCount = Object.values(importPlan.images).filter((image) => image.people.some((entry) => entry.personId === conflict.importedId)).length

	releaseImportCompare()

	let token = importCompareToken

	document.getElementById(`importApplyAll`).checked = false

	showImportView({
		title : `Conflict ${importConflictIndex + 1} of ${importConflicts.length}`,
		message : `${conflict.label} in the file has the same name as someone already here. What should happen to the one in the file?`,
		compareHtml : buildConflictCompareHtml(persons[conflict.existingId], importedPerson, getGalleryImageIds(conflict.existingId).length, importedImageCount),
		showApplyAll : importConflicts.length - importConflictIndex > 1,
		buttons : [`importCancel`, `importKeepCurrent`, `importKeepBoth`, `importReplacePerson`]
	})

	await loadImportComparePictures(conflict, importedPerson, token)
}

function startImportConflictReview() {
	importConflictIndex = 0
	importResolutions = {}

	renderImportConflict()
}

// Records the answer, for this conflict, or for this one and every one after it when Apply to all is ticked, and goes to the next conflict, after the last one the import is made
function chooseImportResolution(kind) {
	let lastIndex = document.getElementById(`importApplyAll`).checked ? importConflicts.length : importConflictIndex + 1

	for(let index = importConflictIndex; index < lastIndex; index++){
		importResolutions[importConflicts[index].importedId] = {
			kind : kind,
			existingId : importConflicts[index].existingId
		}
	}

	importConflictIndex = lastIndex

	if(importConflictIndex >= importConflicts.length){
		applyImport(importPlan, `merge`, importResolutions)
	} else {
		renderImportConflict()
	}
}

// The dialog is one place for every step, checking, choosing, saving and errors, a view says which text and which buttons to show
function showImportView(view) {
	document.getElementById(`importTitle`).textContent = view.title
	document.getElementById(`importMessage`).textContent = view.message ?? ``
	document.getElementById(`importSummary`).innerHTML = view.summaryHtml ?? ``
	document.getElementById(`importCompare`).innerHTML = view.compareHtml ?? ``
	document.getElementById(`importApplyAllLabel`).hidden = !view.showApplyAll
	document.getElementById(`importIssue`).textContent = view.issue ? `\u26a0 ${view.issue}` : ``

	for(let buttonId of [`importCancel`, `importMerge`, `importReplace`, `importClose`, `importKeepCurrent`, `importKeepBoth`, `importReplacePerson`]){
		document.getElementById(buttonId).hidden = !(view.buttons ?? []).includes(buttonId)
	}
}

function chooseImportFile() {
	document.getElementById(`importInput`).click()
}

function readImportFile(event) {
	let file = event.target.files[0]

	event.target.value = ``

	if(file){
		startImport(file)
	}
}

// The file is checked completely before anything else happens, an empty browser has nothing to lose or to clash with, so it is imported at once, otherwise the choice is shown, the token tells a late result that the dialog was closed meanwhile
async function startImport(file) {
	importCheckToken += 1

	let token = importCheckToken

	importPlan = null

	showImportView({
		title : `Import`,
		message : `Checking the file\u2026`,
		buttons : [`importCancel`]
	})

	if(!document.getElementById(`importDialog`).open){
		document.getElementById(`importDialog`).showModal()
	}

	let plan

	try {
		plan = await buildImportPlan(file, (done, total) => {
			if(token === importCheckToken){
				document.getElementById(`importMessage`).textContent = `Checking image ${done} of ${total}\u2026`
			}
		}, () => token !== importCheckToken)
	} catch(error) {
		if(token === importCheckToken){
			showImportView({
				title : `Import failed`,
				issue : error.message,
				buttons : [`importClose`]
			})
		}

		return
	}

	if(!plan || token !== importCheckToken){
		return
	}

	importPlan = plan
	importConflicts = findImportConflicts(plan.persons)

	if(Object.keys(persons).length == 0 && Object.keys(images).length == 0){
		await applyImport(plan, `replace`)

		return
	}

	showImportView({
		title : `Import`,
		summaryHtml : buildImportSummaryHtml(plan, importConflicts),
		buttons : [`importCancel`, `importMerge`, `importReplace`]
	})
}

// Merge asks about each person who has the same name as someone here, when there is none it goes straight ahead
function chooseImportMode(mode) {
	if(!importPlan){
		return
	}

	if(mode == `merge` && importConflicts.length > 0){
		startImportConflictReview()

		return
	}

	applyImport(importPlan, mode)
}

function closeImportDialog() {
	document.getElementById(`importDialog`).close()
}

// Runs whenever the dialog closes, a check in progress is dropped
function releaseImport() {
	importCheckToken += 1
	importPlan = null

	releaseImportCompare()
}

// The dialog cannot be closed with Escape while the data is being written, because stopping halfway would leave a mixture
function handleImportCancel(event) {
	if(isImporting){
		event.preventDefault()
	}
}

// A person from the file in the newest form, copied so the file's own data is never changed, names and dates are converted if they were saved in an older form
function prepareImportedPerson(importedPerson) {
	let person = JSON.parse(JSON.stringify(importedPerson))

	migrateDates(person)
	migrateNames(person)

	return person
}

// The file's people and images with new ids, personIdMap and imageIdMap say which new id each old id became, ids that are kept are mapped to themselves, so Replace and Merge share this code, references are updated in the people, the images and the history, a person kept as the one here is not written at all, only mapped to their id here so the images of the file are listed under them, a person listed in an image who is not in the file is dropped from the image, and a profile picture that is not in the file is dropped, names and dates are brought to the newest form, and thumbnailJobs lists the profile pictures to make again from their originals, because thumbnails are not exported
function buildImportedData(plan, personIdMap, imageIdMap, keptPersonIds = new Set()) {
	let newPersons = {}
	let newImages = {}
	let thumbnailJobs = []

	for(let [oldPersonId, importedPerson] of Object.entries(plan.persons)){
		if(keptPersonIds.has(oldPersonId)){
			continue
		}

		let person = prepareImportedPerson(importedPerson)
		let oldImageId = person.profileImageId

		if(oldImageId != null && imageIdMap[oldImageId] !== undefined){
			person.profileImageId = imageIdMap[oldImageId]

			if(plan.originals.has(Number(oldImageId))){
				thumbnailJobs.push({
					personId : personIdMap[oldPersonId],
					blob : plan.originals.get(Number(oldImageId)),
					crop : {
						...getDefaultCrop(),
						...person.profileCrop
					}
				})
			}
		} else {
			delete person.profileImageId
			delete person.profileCrop
		}

		newPersons[personIdMap[oldPersonId]] = person
	}

	for(let [oldImageId, importedImage] of Object.entries(plan.images)){
		let image = JSON.parse(JSON.stringify(importedImage))

		image.people = image.people
			.map((entry) => entry.personId === undefined ? entry : (personIdMap[entry.personId] === undefined ? null : { ...entry, personId : personIdMap[entry.personId] }))
			.filter((entry) => entry)

		newImages[imageIdMap[oldImageId]] = image
	}

	return {
		persons : newPersons,
		images : newImages,
		activeHistory : plan.activeHistory.map((personId) => personIdMap[personId]).filter((personId) => personId !== undefined),
		imageIdMap : imageIdMap,
		thumbnailJobs : thumbnailJobs
	}
}

function buildReplacementData(plan) {
	let personIdMap = Object.fromEntries(Object.keys(plan.persons).map((personId) => [personId, Number(personId)]))
	let imageIdMap = Object.fromEntries(Object.keys(plan.images).map((imageId) => [imageId, Number(imageId)]))

	return buildImportedData(plan, personIdMap, imageIdMap)
}

// Every imported image gets a new id above the highest id here, so nothing that is here can be overwritten, and so does every imported person, except one the answer for was Replace or Keep current, that person takes the id of the person here, resolutions are the answers given for the people who have the same name as someone here
function buildMergedData(plan, resolutions = {}) {
	let nextPersonId = Math.max(0, ...Object.keys(persons).map(Number)) + 1
	let nextImageId = Math.max(0, ...Object.keys(images).map(Number)) + 1
	let personIdMap = {}
	let imageIdMap = {}
	let keptPersonIds = new Set()

	for(let oldPersonId of Object.keys(plan.persons).map(Number).sort((first, second) => first - second)){
		let resolution = resolutions[oldPersonId]

		if(resolution && resolution.kind != `duplicate`){
			personIdMap[oldPersonId] = resolution.existingId

			if(resolution.kind == `keep`){
				keptPersonIds.add(String(oldPersonId))
			}
		} else {
			personIdMap[oldPersonId] = nextPersonId
			nextPersonId += 1
		}
	}

	for(let oldImageId of Object.keys(plan.images).map(Number).sort((first, second) => first - second)){
		imageIdMap[oldImageId] = nextImageId
		nextImageId += 1
	}

	return buildImportedData(plan, personIdMap, imageIdMap, keptPersonIds)
}

// Better to refuse than to run out of room halfway, the browser's own estimate is used with a margin of a tenth, Replace gets back the room of what it deletes, and when the browser gives no estimate the import goes ahead
async function checkImportSpace(plan, mode) {
	if(!navigator.storage?.estimate){
		return
	}

	let estimate = await navigator.storage.estimate()
	let neededBytes = [...plan.originals.values()].reduce((total, blob) => total + blob.size, 0)
	let freedBytes = mode == `replace` ? (await loadOriginalEntries()).reduce((total, entry) => total + entry.blob.size, 0) : 0
	let availableBytes = (estimate.quota - estimate.usage + freedBytes) * 0.9

	if(neededBytes > availableBytes){
		throw new Error(`There is not enough storage space for this import, it needs about ${formatByteSize(neededBytes)} and this browser has about ${formatByteSize(Math.max(0, availableBytes))} free.`)
	}
}

// Writes the pictures of an import, the originals under their new ids, and the thumbnails of the profile pictures made from the originals and the saved crops, a thumbnail that cannot be made is counted and skipped, the square then stays empty until a picture is chosen again
async function writeImportedPictures(plan, result, reportProgress) {
	let originalIds = [...plan.originals.keys()].filter((oldImageId) => result.imageIdMap[oldImageId] !== undefined)
	let failedThumbnailCount = 0

	for(let [index, oldImageId] of originalIds.entries()){
		reportProgress(`Saving image ${index + 1} of ${originalIds.length}\u2026`)

		await saveOriginalBlob(result.imageIdMap[oldImageId], plan.originals.get(oldImageId))
	}

	for(let [index, job] of result.thumbnailJobs.entries()){
		reportProgress(`Making profile picture ${index + 1} of ${result.thumbnailJobs.length}\u2026`)

		try {
			let bitmap = await createImageBitmap(job.blob)
			let thumbnailBlob = await makeCropThumbnailBlob(bitmap, job.crop)

			bitmap.close()

			await saveThumbnailBlob(job.personId, thumbnailBlob)
		} catch {
			failedThumbnailCount += 1
		}
	}

	return failedThumbnailCount
}

// Replace and Merge, in an order that keeps what is here safe for as long as possible, Merge only adds, so its pictures are written first and the details last, if the details cannot be saved nothing is listed that is not stored, Replace has to clear the pictures, so the details are saved first, because their size is the only thing that can still fail, and if they do not fit everything is put back and nothing is cleared, after either, the page is redrawn from nothing so no old picture is shown under a reused id
async function applyImport(plan, mode, resolutions = {}) {
	isImporting = true

	let previousPersons = persons
	let previousImages = images
	let previousHistory = activeHistory
	let failedThumbnailCount = 0
	let hasChangedData = false
	let reportProgress = (message) => showImportView({
		title : `Importing`,
		message : message
	})

	reportProgress(`Preparing\u2026`)

	try {
		await checkImportSpace(plan, mode)

		let result = mode == `merge` ? buildMergedData(plan, resolutions) : buildReplacementData(plan)
		let nextPersons = mode == `merge` ? { ...persons, ...result.persons } : result.persons
		let nextImages = mode == `merge` ? { ...images, ...result.images } : result.images
		let nextHistory = mode == `merge` ? [...result.activeHistory, ...activeHistory].filter((personId, index, list) => list.lastIndexOf(personId) === index) : result.activeHistory
		let saveDetails = () => {
			persons = nextPersons
			images = nextImages
			activeHistory = nextHistory

			try {
				saveData()
			} catch {
				persons = previousPersons
				images = previousImages
				activeHistory = previousHistory

				saveData()

				throw new Error(`This browser has no room left to save the people and images.`)
			}
		}

		if(mode == `merge`){
			hasChangedData = true
			failedThumbnailCount = await writeImportedPictures(plan, result, reportProgress)

			saveDetails()
		} else {
			saveDetails()

			hasChangedData = true

			await clearImageStores()

			failedThumbnailCount = await writeImportedPictures(plan, result, reportProgress)
		}
	} catch(error) {
		isImporting = false

		showImportView({
			title : `Import failed`,
			issue : hasChangedData ? `${error.message} Some of the file was already imported, so import it again with Replace to start clean.` : error.message,
			buttons : [`importClose`]
		})

		clearPhoto()
		clearGallery()
		viewPerson()
		scheduleExportSizeUpdate()

		return
	}

	isImporting = false

	// After Replace the data is the file, so the last export is the date of the file, and nothing has changed since
	if(mode == `replace`){
		let fileDate = new Date(plan.exportedAt)

		markExported(isNaN(fileDate) ? null : fileDate.toISOString())
	}

	clearPhoto()
	clearGallery()
	closeImportDialog()
	viewPerson()
	scheduleExportSizeUpdate()

	let notes = []

	if(plan.missingImageIds.length > 0){
		notes.push(`${describeCount(plan.missingImageIds.length, `image has`, `images have`)} no picture in the file.`)
	}

	if(failedThumbnailCount > 0){
		notes.push(`${describeCount(failedThumbnailCount, `profile picture`, `profile pictures`)} could not be made again, choose them again.`)
	}

	if(notes.length > 0){
		window.alert(`The import is finished. ${notes.join(` `)}`)
	}
}

// Dates and names saved in their old forms are turned into lists, and the person on screen before the refresh is shown again, nothing is shown when the history is empty
Object.values(persons).forEach(migrateDates)
Object.values(persons).forEach(migrateNames)
rememberSavedData()
viewPerson()
scheduleExportSizeUpdate()
updateExportNote()
setInterval(updateExportNote, 60000)?.unref?.()
