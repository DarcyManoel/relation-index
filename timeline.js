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

// The dated milestones of the person on screen, oldest first, the birth, the places they lived in or had another connection with that have a year, the births of their children and of their younger siblings and the deaths of their parents and partners that fall in their lifetime, which needs a known birth year, then the death and the places they were buried in, a burial with no year goes right after the death, or at the end when there is no death, each one is { description, isDated, isOwn, sortTime, whenText }, isDated is false for a burial with no year, which has no place on a line of time, isOwn is false for what happened to the family, and the age is the age of the person at that time
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

	let addEvent = (date, description, isOwn, shouldShowAge) => {
		let age = hasBirthYear && shouldShowAge ? getTimelineAge(birth, date) : null

		events.push({
			description : description,
			isDated : true,
			isOwn : isOwn,
			sortTime : getTimelineYear(date),
			whenText : age == null ? formatDateText(date) : `${formatDateText(date)} \u00b7 Age ${age}`
		})
	}
	let getPlaceText = (placeKind) => {
		let place = places.find((candidatePlace) => candidatePlace.kind == placeKind)

		return place ? ` in ${place.name}` : ``
	}

	if(hasBirthYear){
		addEvent(birth, `Born${getPlaceText(`born`)}`, true, false)
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

				addEvent(relativeDate, `${descriptionPrefix} ${getNameLabel(relative)}`, false, true)
			}
		}
	}

	if(hasDeathYear){
		addEvent(death, `Died${getPlaceText(`died`)}`, true, true)
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
				sortTime : deathTime + .000001,
				whenText : `Date unknown`
			})
		} else {
			addEvent({ year : placeYear, month : null, day : null }, `Buried in ${place.name}`, true, true)
		}
	}

	return events.sort((firstEvent, secondEvent) => firstEvent.sortTime < secondEvent.sortTime ? -1 : firstEvent.sortTime > secondEvent.sortTime ? 1 : 0)
}

// One milestone, a dot on a vertical line on the left, the date with the age in muted grey and the description, the dot of what happened to the person themselves is darker than the dot of what happened to the family, the row shares its index with its dot on the line of time above, so hovering either one can highlight both
function buildTimelineEventHtml(event, index) {
	return `<div class="event${event.isOwn ? ` own` : ``}" data-index="${index}" onmouseenter="highlightLifeEvent(${index}, true)" onmouseleave="highlightLifeEvent(${index}, false)"><div class="marker"><div class="dot"></div><div class="line"></div></div><div class="content"><div class="when">${escapeHtml(event.whenText)}</div><div class="description">${escapeHtml(event.description)}</div></div></div>`
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

	return `<div class="dot${event.isOwn ? ` own` : ``}" data-index="${index}" title="${escapeHtml(`${event.whenText} \u2013 ${event.description}`)}" style="left: ${leftPercent}%;" onmouseenter="highlightLifeEvent(${index}, true)" onmouseleave="highlightLifeEvent(${index}, false)"></div>`
}

// The line of time of the person with a dot for each dated event, from the earliest time of the events or the birth at 0% to the latest time of the events or the end of the life at 100%, the bar of the lifespan has the tint of the gender and fades at the right edge when the person is living, a person with no known lifespan has the line and the dots only, and under it the list of every event, an event with no year is only in the list
function buildLifeEventsBodyHtml(personId, events) {
	let entry = getTimelineEntry(personId, true)
	let datedTimes = events.filter((event) => event.isDated).map((event) => event.sortTime)
	let minTime = Math.min(...datedTimes, ...(entry ? [entry.startTime] : []))
	let maxTime = Math.max(...datedTimes, ...(entry ? [entry.endTime] : []))

	if(maxTime <= minTime){
		maxTime = minTime + 1
	}

	let layout = entry ? getTimelineRowLayout(entry, minTime, maxTime) : null
	let barHtml = entry ? `<div class="bar ${escapeHtml(entry.genderValue)}${entry.isLiving ? ` living` : ``}" style="left: ${layout.leftPercent}%; width: ${layout.widthPercent}%;"></div>` : ``
	let dotsHtml = events.map((event, index) => event.isDated ? buildLifeEventDotHtml(event, index, minTime, maxTime) : ``).join(``)

	return `<div class="lifeEventsBody"><div class="track">${barHtml}${dotsHtml}</div><div class="events">${events.map(buildTimelineEventHtml).join(``)}</div></div>`
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

// Draws the life events of the person on screen in their own island under the relations and the family timeline, the two islands are independent and both can be on screen, nothing is drawn when the person has no event with a year
function renderLifeEvents(personId) {
	personId = Number(personId)

	let events = getTimelineEvents(personId)

	if(!events.some((event) => event.isDated)){
		clearLifeEvents()

		return
	}

	document.getElementById(`lifeEvents`).innerHTML = `<div class="heading"><span>Life events</span></div>${buildLifeEventsBodyHtml(personId, events)}`
}
