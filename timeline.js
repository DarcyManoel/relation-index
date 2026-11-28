// The people on the timeline are the person on screen and everyone linked to them directly, as a parent, sibling, partner or child, each one only once, the answer is a map from the id of each person to whether they are the active person, and a person written down as plain text has no page so they are left out
function getTimelinePeopleIds(personId) {
	let peopleIds = new Map([[personId, true]])

	for(let role of [`parents`, `siblings`, `partners`, `children`]){
		for(let entry of persons[personId]?.relations?.[role] ?? []){
			if(entry.personId == null || !persons[Number(entry.personId)] || peopleIds.has(Number(entry.personId))){
				continue
			}

			peopleIds.set(Number(entry.personId), false)
		}
	}

	return peopleIds
}

// A date as a continuous number of years, an unknown month or day counts as the first one
function getTimelineYear(date) {
	return date.year + ((date.month ?? 1) - 1) / 12 + ((date.day ?? 1) - 1) / 365.25
}

// Today as a continuous number of years, from the real time of day so the bar of a living person grows a little every day
function getTodayTimelineYear() {
	let now = new Date()
	let yearStart = new Date(now.getFullYear(), 0, 1)

	return now.getFullYear() + (now.getTime() - yearStart.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
}

// A person only gets a bar when the dates are known well enough for it to be right, a birth year is needed, a death year ends the bar and when only the year is known the bar ends at the end of that year, a person declared dead with no death year has no end to draw so they are left out, and a person with no death at all is living and their bar runs up to today, the answer is null for a person who is left out
function getTimelineEntry(personId, isActive) {
	let person = persons[personId]
	let birth = getPreferredDate(person, `birth`)

	if(birth?.year == null){
		return null
	}

	let death = getPreferredDate(person, `death`)
	let isLiving = false
	let endTime = 0

	if(death?.year != null){
		endTime = death.month == null && death.day == null ? death.year + .99 : getTimelineYear(death)
	} else if(person.isDeceased === true){
		return null
	} else {
		isLiving = true
		endTime = getTodayTimelineYear()
	}

	return {
		birth : birth,
		death : death,
		endTime : endTime,
		genderValue : getPreferredGender(person)?.value ?? `unknown`,
		isActive : isActive,
		isLiving : isLiving,
		name : getNameLabel(person),
		person : person,
		personId : personId,
		startTime : getTimelineYear(birth)
	}
}

// The years that get a vertical line, the smallest step of 1, 2, 5, 10, 20 or 25 years that gives no more than 8 lines, a span so long that even 25 years gives more doubles the step until it fits, and the lines are on the multiples of the step that fall inside the axis
function getTimelineGridYears(minTime, maxTime) {
	let getLineCount = (step) => Math.floor(maxTime / step) - Math.ceil(minTime / step) + 1
	let step = [1, 2, 5, 10, 20, 25].find((candidateStep) => getLineCount(candidateStep) <= 8) ?? 25
	let gridYears = []

	while(getLineCount(step) > 8){
		step *= 2
	}

	for(let gridYear = Math.ceil(minTime / step) * step; gridYear <= maxTime; gridYear += step){
		gridYears.push(gridYear)
	}

	return gridYears
}

function roundTimelinePercent(value) {
	return Math.round(value * 1000) / 1000
}

// Where the bar of a person goes on the chart, as shares of the width of the chart, a bar is never narrower than a sliver so it can always be seen, and one that would run past the right edge is moved left so it ends on it
function getTimelineRowLayout(entry, minTime, maxTime) {
	let axisLength = maxTime - minTime
	let widthPercent = roundTimelinePercent(Math.max(((entry.endTime - entry.startTime) / axisLength) * 100, .6))
	let leftPercent = roundTimelinePercent(Math.min(((entry.startTime - minTime) / axisLength) * 100, 100 - widthPercent))

	return {
		leftPercent : leftPercent,
		widthPercent : widthPercent
	}
}

// The bar of a person, and the dates that show when the row is hovered, the dates start at the same place as the bar so they appear right at its beginning, except for a bar that starts in the right part of the chart, where they end at the end of the bar instead so they stay inside the chart and never cover the names, the name is not here, it is in the column of names beside the chart, the row and its name share an index so hovering either one can highlight both
function buildTimelineRowHtml(entry, layout, index) {
	let datesText = `${formatDateText(entry.birth)} \u2013 ${entry.isLiving ? `present` : formatDateText(entry.death)}`
	let datesStyle = layout.leftPercent <= 65 ? `left: ${layout.leftPercent}%;` : `right: ${Math.max(0, roundTimelinePercent(100 - (layout.leftPercent + layout.widthPercent)))}%;`

	return `<div class="row${entry.isActive ? ` active` : ``}" data-index="${index}" onmouseenter="highlightTimelineRow(${index}, true)" onmouseleave="highlightTimelineRow(${index}, false)"><div class="bar ${escapeHtml(entry.genderValue)}${entry.isLiving ? ` living` : ``}${entry.isActive ? ` active` : ``}" style="left: ${layout.leftPercent}%; width: ${layout.widthPercent}%;"></div><span class="barDates" style="${datesStyle}">${escapeHtml(datesText)}</span></div>`
}

// One name in the column of names, the rows of that column are as tall as the rows of the chart and have the same gap, so each name lines up with its bar, and it shares the index of its row
function buildTimelineLabelHtml(entry, index) {
	return `<div class="barLabel${entry.isActive ? ` active` : ``}" data-index="${index}" onmouseenter="highlightTimelineRow(${index}, true)" onmouseleave="highlightTimelineRow(${index}, false)">${escapeHtml(entry.name)}</div>`
}

// A row and its name light up together, whichever of the two the mouse is on
function highlightTimelineRow(index, isHovered) {
	for(let element of document.querySelectorAll(`#timeline [data-index="${index}"]`)){
		element.classList.toggle(`hovered`, isHovered)
	}
}

function buildTimelineGridlinesHtml(minTime, maxTime) {
	return getTimelineGridYears(minTime, maxTime)
		.map((gridYear) => `<div class="gridline" style="left: ${roundTimelinePercent(((gridYear - minTime) / (maxTime - minTime)) * 100)}%;"><span class="yearLabel">${gridYear}</span></div>`)
		.join(``)
}

function clearTimeline() {
	document.getElementById(`timeline`).innerHTML = ``
}

// The entries of the family timeline, the person and everyone linked to them directly who have dates that are known well enough, the oldest birth first, the answer is an empty list when the person has no links or when nobody has such dates
function getTimelineFamilyEntries(personId) {
	let peopleIds = persons[personId] ? getTimelinePeopleIds(personId) : new Map()

	if(peopleIds.size < 2){
		return []
	}

	return [...peopleIds]
		.map(([entryPersonId, isActive]) => getTimelineEntry(entryPersonId, isActive))
		.filter((entry) => entry)
		.sort((firstEntry, secondEntry) => firstEntry.startTime - secondEntry.startTime || firstEntry.personId - secondEntry.personId)
}

// Draws the lifespans of the person and of everyone linked to them directly on one shared axis, oldest birth at the top, nothing is drawn when the person has no links or when nobody has dates that are known well enough, and the bars are not links so clicking them does nothing
function buildTimelineFamilyBodyHtml(entries) {
	if(entries.length < 1){
		return ``
	}

	let minTime = Math.min(...entries.map((entry) => Math.min(entry.startTime, entry.endTime)))
	let maxTime = Math.max(...entries.map((entry) => Math.max(entry.startTime, entry.endTime)))

	if(maxTime <= minTime){
		maxTime = minTime + 1
	}

	let rowsHtml = entries.map((entry, index) => buildTimelineRowHtml(entry, getTimelineRowLayout(entry, minTime, maxTime), index)).join(``)
	let labelsHtml = entries.map((entry, index) => buildTimelineLabelHtml(entry, index)).join(``)

	return `<div class="timelineBody"><div class="chartArea"><div class="gridlines">${buildTimelineGridlinesHtml(minTime, maxTime)}</div><div class="rows">${rowsHtml}</div></div><div class="labelsArea">${labelsHtml}</div></div>`
}

// The age of the person at a date in whole years, a birthday that has not come yet in that year is not counted when the months and days are known, and the answer is null when the date is before the birth
function getTimelineAge(birth, date) {
	let age = date.year - birth.year

	if(birth.month != null && date.month != null && (date.month < birth.month || (date.month == birth.month && birth.day != null && date.day != null && date.day < birth.day))){
		age -= 1
	}

	return age >= 0 ? age : null
}

// The dated milestones of the person on screen, oldest first, the birth, the places they lived in or had another connection with that have a year, the births of their children and of their younger siblings and the deaths of their parents and partners that fall in their lifetime, which needs a known birth year, then the marriage or union and the separation of each partner link that has a year of its own, then the custom events that the user wrote, which have a start and may have an end, then the death and the places they were buried in, a burial with no year goes right after the death, or at the end when there is no death, each one is { description, isDated, isOwn, key, sortTime, whenText, significanceKey, isSignificant }, key says which event it is and stays the same when the page is drawn again, the significance of an event is kept on the person under significanceKey, which is the key of the event, or for a custom event the key of the custom event, so the start and the end of one share it, an event is significant unless the person has said it is not, a custom event also has customEventId and, when it has an end, pairId, isDated is false for a burial with no year, which has no place on a line of time, isOwn is false for what happened to the family, and the age is the age of the person at that time
function getTimelineEvents(personId) {
	let person = persons[personId]

	if(!person){
		return []
	}

	let birth = getPreferredDate(person, `birth`)
	let death = getPreferredDate(person, `death`)
	let hasBirthYear = birth?.year != null
	let hasDeathYear = death?.year != null
	let places = person.places ?? []
	let events = []

	let addEvent = (date, description, isOwn, shouldShowAge, key, extras = {}) => {
		let age = hasBirthYear && shouldShowAge ? getTimelineAge(birth, date) : null

		events.push({
			description : description,
			isDated : true,
			isOwn : isOwn,
			key : key,
			sortTime : getTimelineYear(date),
			whenText : age == null ? formatDateText(date) : `${formatDateText(date)} \u00b7 Age ${age}`,
			...extras
		})
	}
	let getPlaceText = (placeKind) => {
		let place = places.find((candidatePlace) => candidatePlace.kind == placeKind)

		return place ? ` in ${place.name}` : ``
	}

	if(hasBirthYear){
		addEvent(birth, `Born${getPlaceText(`born`)}`, true, false, `birth`)
	}

	for(let place of places){
		let placeYear = place.fromYear ?? place.toYear

		if((place.kind != `lived` && place.kind != `other`) || placeYear == null){
			continue
		}

		let yearsText = getPlaceYearsText(place, ` \u2013 `)
		let placeAge = hasBirthYear ? getTimelineAge(birth, { year : placeYear, month : null, day : null }) : null

		events.push({
			description : `${place.kind == `lived` ? `Lived in` : `Other place:`} ${place.name}`,
			isDated : true,
			isOwn : true,
			key : `place:${place.kind}:${normalizeNameText(place.name)}:${placeYear}`,
			placeIndex : places.indexOf(place),
			sortTime : placeYear,
			whenText : placeAge == null ? (place.fromYear == null ? `until ${yearsText}` : yearsText) : `${place.fromYear == null ? `until ${yearsText}` : yearsText} \u00b7 Age ${placeAge}`
		})
	}

	if(hasBirthYear){
		let birthTime = getTimelineYear(birth)

		for(let [relationRole, descriptionPrefix, dateKind] of [[`children`, `Birth of child`, `birth`], [`siblings`, `Birth of sibling`, `birth`], [`parents`, `Death of parent`, `death`], [`partners`, `Death of partner`, `death`]]){
			for(let entry of person.relations?.[relationRole] ?? []){
				let relative = entry.personId == null ? null : persons[Number(entry.personId)]
				let relativeDate = relative ? getPreferredDate(relative, dateKind) : null

				if(relativeDate?.year == null || relativeDate.year < birth.year || (hasDeathYear && relativeDate.year > death.year)){
					continue
				}

				if(relationRole == `siblings` && getTimelineYear(relativeDate) <= birthTime){
					continue
				}

				addEvent(relativeDate, `${descriptionPrefix} ${getNameLabel(relative)}`, false, true, `relative:${relationRole}:${entry.personId}`, {
					relatedPersonId : Number(entry.personId),
					relationRole : relationRole
				})
			}
		}
	}

	for(let entry of person.relations?.partners ?? []){
		let variant = isRenderableRelationEntry(entry) ? getPreferredRelationVariant(entry) : null

		if(!variant){
			continue
		}

		let partnerName = getRelationEntryLabel(entry)
		let partnerKey = entry.personId ?? `text:${normalizeNameText(entry.text)}`
		let partnerExtras = {
			relatedPersonId : entry.personId == null ? null : Number(entry.personId),
			relationRole : `partners`
		}

		if(variant.date?.year != null){
			addEvent(variant.date, `${variant.subtype == `married` ? `Married` : `Partnered with`} ${partnerName}`, true, true, `partner:${partnerKey}:start`, partnerExtras)
		}

		if(variant.subtype == `separated` && variant.endDate?.year != null){
			addEvent(variant.endDate, `Separated from ${partnerName}`, true, true, `partner:${partnerKey}:end`, partnerExtras)
		}
	}

	for(let customEvent of person.customEvents ?? []){
		let extras = {
			customEventId : customEvent.id,
			pairId : customEvent.endDate ? customEvent.id : null,
			significanceKey : `custom:${customEvent.id}`
		}

		addEvent(customEvent.date, customEvent.title, true, true, `custom:${customEvent.id}:start`, extras)

		if(customEvent.endDate){
			addEvent(customEvent.endDate, customEvent.endTitle, true, true, `custom:${customEvent.id}:end`, extras)
		}
	}

	if(hasDeathYear){
		addEvent(death, `Died${getPlaceText(`died`)}`, true, true, `death`)
	}

	let deathTime = hasDeathYear ? getTimelineYear(death) : Infinity

	for(let place of places){
		if(place.kind != `buried`){
			continue
		}

		let placeYear = place.fromYear ?? place.toYear

		if(placeYear == null){
			events.push({
				description : `Buried in ${place.name}`,
				isDated : false,
				isOwn : true,
				key : `burial:${normalizeNameText(place.name)}`,
				placeIndex : places.indexOf(place),
				sortTime : deathTime + .000001,
				whenText : `Date unknown`
			})
		} else {
			addEvent({ year : placeYear, month : null, day : null }, `Buried in ${place.name}`, true, true, `burial:${normalizeNameText(place.name)}`, {
				placeIndex : places.indexOf(place)
			})
		}
	}

	return events
		.sort((firstEvent, secondEvent) => firstEvent.sortTime < secondEvent.sortTime ? -1 : firstEvent.sortTime > secondEvent.sortTime ? 1 : 0)
		.map((event) => {
			let significanceKey = event.significanceKey ?? event.key

			return {
				...event,
				isSignificant : person.eventSignificance?.[significanceKey] !== false,
				significanceKey : significanceKey
			}
		})
}

// One milestone, a button on a vertical line on the left that is a star when the event is significant and a smaller dot when it is not, and a click on it changes that, the date with the age in muted grey and the description, the button of what happened to the person themselves is darker than the button of what happened to the family, a custom event can be clicked to edit it, the row shares its index with its dot on the line of time above, so hovering either one can highlight both
function buildTimelineEventHtml(event, index) {
	let significanceKeyArgument = escapeHtml(JSON.stringify(event.significanceKey))
	let markerHtml = event.isSignificant ? `<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>` : `<span class="dot"></span>`
	let contentAttributes = event.customEventId ? ` custom" tabindex="0" onclick="openLifeEventDialog(${escapeHtml(JSON.stringify(event.customEventId))})" onkeydown="handleLifeEventKey(event, ${escapeHtml(JSON.stringify(event.customEventId))})` : ``
	let dataAttributes = [
		`data-key="${escapeHtml(event.key)}"`,
		`data-significance-key="${escapeHtml(event.significanceKey)}"`,
		event.customEventId ? `data-custom-event-id="${escapeHtml(event.customEventId)}"` : ``,
		event.placeIndex == null ? `` : `data-place-index="${event.placeIndex}"`,
		event.relatedPersonId == null ? `` : `data-related-person-id="${event.relatedPersonId}"`,
		event.relationRole ? `data-relation-role="${escapeHtml(event.relationRole)}"` : ``
	].filter((attribute) => attribute != ``).join(` `)

	return `<div class="event${event.isOwn ? ` own` : ``}${event.isSignificant ? `` : ` insignificant`}" data-index="${index}" ${dataAttributes} onmouseenter="highlightLifeEvent(${index}, true)" onmouseleave="highlightLifeEvent(${index}, false)"><div class="marker"><button type="button" class="toggle" title="${event.isSignificant ? `Mark as insignificant` : `Mark as significant`}" onclick="toggleLifeEventSignificance(event, ${significanceKeyArgument})">${markerHtml}</button><div class="line"></div></div><div class="content${contentAttributes}"><div class="when">${escapeHtml(event.whenText)}${event.customEventId ? `<span class="edit">edit</span>` : ``}</div><div class="description">${escapeHtml(event.description)}</div></div></div>`
}

// A row and its dot on the line of time light up together, whichever of the two the mouse is on
function highlightLifeEvent(index, isHovered) {
	for(let element of document.querySelectorAll(`#lifeEvents [data-index="${index}"]`)){
		element.classList.toggle(`hovered`, isHovered)
	}
}

// The dot of an event on the line of time, where it goes is the share of the line that the time of the event is at, and the text that shows when the mouse rests on it is the date and the description
function buildLifeEventDotHtml(event, index, minTime, maxTime) {
	let leftPercent = roundTimelinePercent(Math.min(Math.max(((event.sortTime - minTime) / (maxTime - minTime)) * 100, 0), 100))

	return `<div class="dot${event.isOwn ? ` own` : ``}${event.isSignificant ? `` : ` minor`}" data-index="${index}" title="${escapeHtml(`${event.whenText} \u2013 ${event.description}`)}" style="left: ${leftPercent}%;" onmouseenter="highlightLifeEvent(${index}, true)" onmouseleave="highlightLifeEvent(${index}, false)"></div>`
}

// The line of time of the person with a dot for each dated event, from the earliest time of the events or the birth at 0% to the latest time of the events or the end of the life at 100%, the bar of the lifespan has the tint of the gender and fades at the right edge when the person is living, a person with no known lifespan has the line and the dots only, and under it the list of the events that are shown, an event with no year is only in the list, the line is always as long as it is with every event on it, so choosing between the significant events and all of them never moves a dot, and only the events that are shown get a dot
function buildLifeEventsBodyHtml(personId, visibleEvents, allEvents) {
	let entry = getTimelineEntry(personId, true)
	let datedTimes = allEvents.filter((event) => event.isDated).map((event) => event.sortTime)
	let trackHtml = ``

	if(datedTimes.length > 0 || entry){
		let minTime = Math.min(...datedTimes, ...(entry ? [entry.startTime] : []))
		let maxTime = Math.max(...datedTimes, ...(entry ? [entry.endTime] : []))

		if(maxTime <= minTime){
			maxTime = minTime + 1
		}

		let layout = entry ? getTimelineRowLayout(entry, minTime, maxTime) : null
		let barHtml = entry ? `<div class="bar ${escapeHtml(entry.genderValue)}${entry.isLiving ? ` living` : ``}" style="left: ${layout.leftPercent}%; width: ${layout.widthPercent}%;"></div>` : ``
		let dotsHtml = visibleEvents.map((event, index) => event.isDated ? buildLifeEventDotHtml(event, index, minTime, maxTime) : ``).join(``)

		trackHtml = `<div class="track">${barHtml}${dotsHtml}</div>`
	}

	if(visibleEvents.length < 1){
		return `<div class="lifeEventsBody">${trackHtml}<div class="none">${allEvents.length < 1 ? `No dated events yet` : `No significant events, switch to All to see the others`}</div></div>`
	}

	return `<div class="lifeEventsBody">${trackHtml}<div class="events">${visibleEvents.map(buildTimelineEventHtml).join(``)}</div></div>`
}

// Draws the family timeline of the person on screen in its own island, and nothing when there is nothing to draw
function renderTimeline(personId) {
	let familyEntries = getTimelineFamilyEntries(Number(personId))

	if(familyEntries.length < 1){
		clearTimeline()

		return
	}

	document.getElementById(`timeline`).innerHTML = `<div class="heading"><span>Family timeline</span></div>${buildTimelineFamilyBodyHtml(familyEntries)}`
}

function clearLifeEvents() {
	document.getElementById(`lifeEvents`).innerHTML = ``
}

// Which events the island shows, false for the significant ones only and true for all of them, it is kept here and not for each person, so it stays the same when another person is opened
let lifeEventsShowAll = false

// The person that the life events were drawn for last, so a click on a star, on the filter or on Add Event knows whose events they are
let renderedLifeEventsPersonId = null

// The significance of an event is kept on the person as eventSignificance, an object from the significanceKey of an event to false, only the events that are not significant are in it, so a person with none has no such property, this puts one event in or takes it out
function setLifeEventSignificance(person, significanceKey, isSignificant) {
	let overrides = { ...(person.eventSignificance ?? {}) }

	if(isSignificant){
		delete overrides[significanceKey]
	} else {
		overrides[significanceKey] = false
	}

	if(Object.keys(overrides).length == 0){
		delete person.eventSignificance
	} else {
		person.eventSignificance = overrides
	}
}

// What was said about an event that is not there any more is taken away, such as the birth of a child who was removed or a place that was changed, this is done every time the events are drawn, because the events are worked out from the other data, and it is saved only when something was taken away
function pruneLifeEventSignificance(personId, events) {
	let person = persons[personId]
	let overrides = person?.eventSignificance

	if(!overrides){
		return
	}

	let validKeys = new Set(events.map((event) => event.significanceKey))
	let orphanKeys = Object.keys(overrides).filter((significanceKey) => !validKeys.has(significanceKey))

	if(orphanKeys.length == 0){
		return
	}

	for(let orphanKey of orphanKeys){
		setLifeEventSignificance(person, orphanKey, true)
	}

	saveData()
}

// Draws the life events again without the page jumping, the island is built again and its height can change for a moment, so the place on the page is put back
function redrawLifeEventsKeepingScroll() {
	let scrollTop = document.scrollingElement.scrollTop

	renderLifeEvents(renderedLifeEventsPersonId)

	document.scrollingElement.scrollTop = scrollTop
}

function setLifeEventsFilter(showAll) {
	lifeEventsShowAll = showAll

	redrawLifeEventsKeepingScroll()
}

// A click on the star or the dot of an event, the event changes between significant and not, it is saved, which counts as a change for the backup note, and both the line of time and the list are drawn again, a click on the button must not also open the event, so it is stopped here
function toggleLifeEventSignificance(event, significanceKey) {
	event.stopPropagation()

	let person = persons[renderedLifeEventsPersonId]

	if(!person){
		return
	}

	setLifeEventSignificance(person, significanceKey, person.eventSignificance?.[significanceKey] === false)
	saveData()
	redrawLifeEventsKeepingScroll()
}

// A year, a month and a day that is a date, the year has to be there, anything else is no date
function sanitizeLifeEventDate(date) {
	let sanitizedDate = sanitizePartnerDate(date)

	return sanitizedDate && sanitizedDate.year != null ? sanitizedDate : null
}

function generateLifeEventId() {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// One custom event made safe, { id, title, date, endTitle, endDate, note, links }, the title and a date with a year are needed, the end is only kept when it has both a title and a date with a year, and an id that is missing or used already is replaced, the answer is null for an event that is not valid
function sanitizeCustomEvent(customEvent, usedIds) {
	let title = typeof customEvent.title == `string` ? customEvent.title.trim().replace(/\s+/g, ` `) : ``
	let date = sanitizeLifeEventDate(customEvent.date)

	if(title == `` || !date){
		return null
	}

	let id = typeof customEvent.id == `string` && customEvent.id != `` && !usedIds.has(customEvent.id) ? customEvent.id : generateLifeEventId()
	let endTitle = typeof customEvent.endTitle == `string` ? customEvent.endTitle.trim().replace(/\s+/g, ` `) : ``
	let endDate = sanitizeLifeEventDate(customEvent.endDate)
	let note = typeof customEvent.note == `string` ? customEvent.note.trim() : ``

	usedIds.add(id)

	return {
		id : id,
		title : title,
		date : date,
		...(endTitle != `` && endDate ? { endTitle : endTitle, endDate : endDate } : {}),
		...(note == `` ? {} : { note : note }),
		links : sanitizeLinks(customEvent)
	}
}

// What a person written into a file by hand or by an older version may hold is made safe, customEvents and eventSignificance are left off when they are empty, this is done when the page starts and when a file is imported
function sanitizeLifeEvents(person) {
	if(person.eventSignificance !== undefined){
		let overrides = isPlainObject(person.eventSignificance) ? Object.fromEntries(Object.entries(person.eventSignificance).filter(([significanceKey, value]) => significanceKey != `` && value === false)) : {}

		if(Object.keys(overrides).length == 0){
			delete person.eventSignificance
		} else {
			person.eventSignificance = overrides
		}
	}

	if(person.customEvents !== undefined){
		let usedIds = new Set()
		let customEvents = (Array.isArray(person.customEvents) ? person.customEvents : [])
			.filter(isPlainObject)
			.map((customEvent) => sanitizeCustomEvent(customEvent, usedIds))
			.filter((customEvent) => customEvent)

		if(customEvents.length == 0){
			delete person.customEvents
		} else {
			person.customEvents = customEvents
		}
	}
}

// Draws the life events of the person on screen in their own island under the relations and the family timeline, the two islands are independent and both can be on screen, the heading has Add Event and next to it the filter between the significant events and all of them, the island is always drawn for a person, so an event can be added to a person who has none yet, and the significance of events that are gone is cleaned up first
function renderLifeEvents(personId) {
	personId = Number(personId)
	renderedLifeEventsPersonId = personId

	if(!persons[personId]){
		clearLifeEvents()

		return
	}

	let events = getTimelineEvents(personId)

	pruneLifeEventSignificance(personId, events)

	let visibleEvents = lifeEventsShowAll ? events : events.filter((event) => event.isSignificant)
	let headerHtml = `<div class="header"><div class="heading" onclick="openLifeEventDialog()"><span>Life events</span><span class="action">+ Add Event</span></div><div class="filter"><span class="option${lifeEventsShowAll ? `` : ` selected`}" onclick="setLifeEventsFilter(false)">Significant</span><span class="option${lifeEventsShowAll ? ` selected` : ``}" onclick="setLifeEventsFilter(true)">All</span></div></div>`

	document.getElementById(`lifeEvents`).innerHTML = `${headerHtml}${buildLifeEventsBodyHtml(personId, visibleEvents, events)}`
}

// What the dialog is working on, whose event it is, which custom event it is when one is edited, and whether the event is significant, the rest is in the boxes
let lifeEventDraft = {
	personId : null,
	eventId : null,
	isSignificant : true
}

function getLifeEventDateTexts(date) {
	return {
		day : date?.day == null ? `` : `${date.day}`,
		month : date?.month == null ? `` : `${date.month}`,
		year : date?.year == null ? `` : `${date.year}`.padStart(4, `0`)
	}
}

function readLifeEventDateTexts(prefix) {
	return {
		day : document.getElementById(`${prefix}Day`).value.trim(),
		month : document.getElementById(`${prefix}Month`).value.trim(),
		year : document.getElementById(`${prefix}Year`).value.trim()
	}
}

function writeLifeEventDateTexts(prefix, texts) {
	document.getElementById(`${prefix}Day`).value = texts.day
	document.getElementById(`${prefix}Month`).value = texts.month
	document.getElementById(`${prefix}Year`).value = texts.year
}

function buildLifeEventDateFromTexts(texts) {
	return sanitizeLifeEventDate({
		year : texts.year == `` ? null : Number(texts.year),
		month : texts.month == `` ? null : Number(texts.month),
		day : texts.day == `` ? null : Number(texts.day)
	})
}

function isLifeEventDateTextsEmpty(texts) {
	return texts.day == `` && texts.month == `` && texts.year == ``
}

function renderLifeEventSignificanceChoices() {
	document.getElementById(`lifeEventSignificanceChoices`).innerHTML = [[true, `Significant \u2605`], [false, `Insignificant \u2022`]]
		.map(([isSignificant, label]) => `<div class="choice${lifeEventDraft.isSignificant === isSignificant ? ` selected` : ``}" onclick="chooseLifeEventSignificance(${isSignificant})">${label}</div>`)
		.join(``)
}

function chooseLifeEventSignificance(isSignificant) {
	lifeEventDraft.isSignificant = isSignificant

	renderLifeEventSignificanceChoices()
}

function showLifeEventIssue(message, elementId = null) {
	document.getElementById(`lifeEventIssue`).textContent = message == `` ? `` : `\u26a0 ${message}`

	if(elementId){
		document.getElementById(elementId).classList.add(`invalid`)
	}
}

// The title of the end only shows when something is typed for the end date, because an end date needs a title of its own
function updateLifeEventDialog() {
	for(let element of document.querySelectorAll(`#lifeEventDialog .invalid`)){
		element.classList.remove(`invalid`)
	}

	showLifeEventIssue(``)

	document.getElementById(`lifeEventEndTitle`).hidden = isLifeEventDateTextsEmpty(readLifeEventDateTexts(`lifeEventEnd`))
}

// Opens the dialog empty to add an event, or filled with the custom event that was asked for, an event with an end is one event with both its halves, Delete is only there for an event that exists
function openLifeEventDialog(customEventId = null) {
	let person = persons[renderedLifeEventsPersonId]

	if(!person){
		return
	}

	let customEvent = customEventId == null ? null : (person.customEvents ?? []).find((candidateEvent) => candidateEvent.id == customEventId)

	lifeEventDraft.personId = renderedLifeEventsPersonId
	lifeEventDraft.eventId = customEvent?.id ?? null
	lifeEventDraft.isSignificant = customEvent ? person.eventSignificance?.[`custom:${customEvent.id}`] !== false : true

	document.getElementById(`lifeEventDialogTitle`).textContent = customEvent ? `Edit event` : `Add event`
	document.getElementById(`lifeEventStartTitle`).value = customEvent?.title ?? ``
	document.getElementById(`lifeEventEndTitle`).value = customEvent?.endTitle ?? ``
	document.getElementById(`lifeEventNote`).value = customEvent?.note ?? ``
	document.getElementById(`lifeEventDelete`).hidden = !customEvent

	writeLifeEventDateTexts(`lifeEventStart`, getLifeEventDateTexts(customEvent?.date))
	writeLifeEventDateTexts(`lifeEventEnd`, getLifeEventDateTexts(customEvent?.endDate))
	renderLifeEventSignificanceChoices()
	renderDynamicLinks(`lifeEventLinks`, customEvent ? [...customEvent.links] : [], () => updateLifeEventDialog())
	updateLifeEventDialog()

	document.getElementById(`lifeEventDialog`).showModal()
}

function closeLifeEventDialog() {
	document.getElementById(`lifeEventDialog`).close()
}

// Enter on a custom event of the list opens it, like a click
function handleLifeEventKey(event, customEventId) {
	if(event.key == `Enter`){
		event.preventDefault()

		openLifeEventDialog(customEventId)
	}
}

// What is wrong with what was typed, as { message, elementId }, or null, the title and a year of the start are needed, a date has to follow the rules of the birth and death dates, and when there is an end date it needs a year, a title and to be after the start
function getLifeEventDraftIssue(startTexts, endTexts) {
	if(document.getElementById(`lifeEventStartTitle`).value.trim() == ``){
		return {
			message : `The event needs a title.`,
			elementId : `lifeEventStartTitle`
		}
	}

	if(startTexts.year == ``){
		return {
			message : `The date needs a year.`,
			elementId : `lifeEventStartYear`
		}
	}

	let startIssue = getDateIssue(startTexts.day, startTexts.month, startTexts.year)

	if(startIssue != ``){
		return {
			message : `Date: ${startIssue}`,
			elementId : `lifeEventStartYear`
		}
	}

	if(isLifeEventDateTextsEmpty(endTexts)){
		return null
	}

	if(endTexts.year == ``){
		return {
			message : `The end date needs a year.`,
			elementId : `lifeEventEndYear`
		}
	}

	let endIssue = getDateIssue(endTexts.day, endTexts.month, endTexts.year)

	if(endIssue != ``){
		return {
			message : `End date: ${endIssue}`,
			elementId : `lifeEventEndYear`
		}
	}

	if(document.getElementById(`lifeEventEndTitle`).value.trim() == ``){
		return {
			message : `The end event needs a title.`,
			elementId : `lifeEventEndTitle`
		}
	}

	if(compareAuditDates(buildLifeEventDateFromTexts(endTexts), buildLifeEventDateFromTexts(startTexts)) < 0){
		return {
			message : `The end date is before the start date.`,
			elementId : `lifeEventEndYear`
		}
	}

	return null
}

// Saves the event as one custom event on the person, with its end when there is one, so clearing the end date makes it a single event again and adding one makes it a pair, its significance is the one that was chosen, and the line of time and the list are drawn again
function saveLifeEvent(event) {
	event.preventDefault()

	let person = persons[lifeEventDraft.personId]

	if(!person){
		return
	}

	let startTexts = readLifeEventDateTexts(`lifeEventStart`)
	let endTexts = readLifeEventDateTexts(`lifeEventEnd`)
	let issue = getLifeEventDraftIssue(startTexts, endTexts)

	if(issue){
		showLifeEventIssue(issue.message, issue.elementId)

		return
	}

	let hasEnd = !isLifeEventDateTextsEmpty(endTexts)
	let customEvent = sanitizeCustomEvent({
		id : lifeEventDraft.eventId ?? generateLifeEventId(),
		title : document.getElementById(`lifeEventStartTitle`).value,
		date : buildLifeEventDateFromTexts(startTexts),
		endTitle : hasEnd ? document.getElementById(`lifeEventEndTitle`).value : ``,
		endDate : hasEnd ? buildLifeEventDateFromTexts(endTexts) : null,
		note : document.getElementById(`lifeEventNote`).value,
		links : readDynamicLinks(`lifeEventLinks`)
	}, new Set())
	let customEvents = person.customEvents ?? []
	let existingIndex = customEvents.findIndex((candidateEvent) => candidateEvent.id == customEvent.id)

	if(existingIndex == -1){
		customEvents.push(customEvent)
	} else {
		customEvents[existingIndex] = customEvent
	}

	person.customEvents = customEvents

	setLifeEventSignificance(person, `custom:${customEvent.id}`, lifeEventDraft.isSignificant)
	saveData()
	closeLifeEventDialog()
	redrawLifeEventsKeepingScroll()
}

// Takes the custom event away with both of its halves and what was said about its significance
function deleteLifeEvent() {
	let person = persons[lifeEventDraft.personId]

	if(!person || lifeEventDraft.eventId == null){
		return
	}

	let customEvents = (person.customEvents ?? []).filter((candidateEvent) => candidateEvent.id != lifeEventDraft.eventId)

	if(customEvents.length == 0){
		delete person.customEvents
	} else {
		person.customEvents = customEvents
	}

	setLifeEventSignificance(person, `custom:${lifeEventDraft.eventId}`, true)
	saveData()
	closeLifeEventDialog()
	redrawLifeEventsKeepingScroll()
}

// What E does on the place of the life events that has the keyboard focus, the heading adds an event, a custom event opens its dialog, the birth and the death open their dates, a place or a burial opens the places dialog on that place, the birth or death of a relative and the dates of a partner open the relations dialog on that list, and anything else changes whether the event is significant
function editLifeEventFocus(element) {
	if(element.matches(`.heading`)){
		openLifeEventDialog()
	} else if(element.dataset.customEventId){
		openLifeEventDialog(element.dataset.customEventId)
	} else if(element.dataset.key == `birth`){
		editBirth()
	} else if(element.dataset.key == `death`){
		editDeath()
	} else if(element.dataset.placeIndex !== undefined){
		openPlacesDialog(Number(element.dataset.placeIndex))
	} else if(element.dataset.relationRole){
		openRelationsDialog(element.dataset.relationRole)
	} else {
		toggleLifeEventFocusSignificance(element)
	}
}

// What Enter does on the place of the life events that has the keyboard focus, an event about a relative or a partner who has a page opens that page, and the first relation of it gets the focus, like Enter on a relation, everything else is the same as E
function openLifeEventFocus(element) {
	if(element.matches(`.event`) && element.dataset.relatedPersonId){
		focusFirstRelationOnLoad = true

		viewPerson(Number(element.dataset.relatedPersonId))
	} else {
		editLifeEventFocus(element)
	}
}

// Puts the keyboard focus back on an event after the island was drawn again, on the same event when it is still shown, and otherwise on the place of the list where it was, which is the next event when the one that was changed has gone from the list of the significant events
function restoreLifeEventFocus(eventKey, previousFocusIndex) {
	let targets = getProfileNavTargets()
	let eventFocusIndex = targets.findIndex((target) => target.matches(`#lifeEvents .event`) && target.dataset.key == eventKey)

	setProfileFocus(eventFocusIndex == -1 ? Math.min(previousFocusIndex, targets.length - 1) : eventFocusIndex)
}

// The key of the star: Space or * changes the event that has the keyboard focus between significant and not, saved like a click on the star, and the focus stays where it was
function toggleLifeEventFocusSignificance(element) {
	let person = persons[renderedLifeEventsPersonId]
	let significanceKey = element.dataset.significanceKey

	if(!person || !significanceKey){
		return
	}

	let eventKey = element.dataset.key
	let previousFocusIndex = profileFocusIndex

	setLifeEventSignificance(person, significanceKey, person.eventSignificance?.[significanceKey] === false)
	saveData()
	redrawLifeEventsKeepingScroll()
	restoreLifeEventFocus(eventKey, previousFocusIndex)
}
