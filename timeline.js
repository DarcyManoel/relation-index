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

// Draws the lifespans of the person and of everyone linked to them directly on one shared axis, oldest birth at the top, nothing is drawn when the person has no links or when nobody has dates that are known well enough, and the bars are not links so clicking them does nothing
function renderTimeline(personId) {
	personId = Number(personId)

	let peopleIds = persons[personId] ? getTimelinePeopleIds(personId) : new Map()

	if(peopleIds.size < 2){
		clearTimeline()

		return
	}

	let entries = [...peopleIds]
		.map(([entryPersonId, isActive]) => getTimelineEntry(entryPersonId, isActive))
		.filter((entry) => entry)
		.sort((firstEntry, secondEntry) => firstEntry.startTime - secondEntry.startTime || firstEntry.personId - secondEntry.personId)

	if(entries.length < 1){
		clearTimeline()

		return
	}

	let minTime = Math.min(...entries.map((entry) => Math.min(entry.startTime, entry.endTime)))
	let maxTime = Math.max(...entries.map((entry) => Math.max(entry.startTime, entry.endTime)))

	if(maxTime <= minTime){
		maxTime = minTime + 1
	}

	let rowsHtml = entries.map((entry, index) => buildTimelineRowHtml(entry, getTimelineRowLayout(entry, minTime, maxTime), index)).join(``)
	let labelsHtml = entries.map((entry, index) => buildTimelineLabelHtml(entry, index)).join(``)

	document.getElementById(`timeline`).innerHTML = `<div class="heading"><span>Timeline</span></div><div class="timelineBody"><div class="chartArea"><div class="gridlines">${buildTimelineGridlinesHtml(minTime, maxTime)}</div><div class="rows">${rowsHtml}</div></div><div class="labelsArea">${labelsHtml}</div></div>`
}
