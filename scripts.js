let persons=[]
function createPerson(){
	persons.push({
		name:{
			given:[`Person`],
			family:[persons.length+1]
		},
	})
	selectPerson(persons.length-1)
}
let relationLinks={
	children:`parents`,
	parents:`children`,
	siblings:`siblings`
}
let relationDisplayOrder=[
	`parents`,
	`siblings`,
	`children`,
]
function selectPerson(id){
	selectedPersonId=id
	renderPerson()
}
function renderPerson(){
	//	name
	document.getElementById(`name`).querySelector(`#given`).innerHTML=persons[selectedPersonId].name?.given.join(`-`)??`-`
	document.getElementById(`name`).querySelector(`#family`).innerHTML=persons[selectedPersonId].name?.family.join(`-`)??`-`
	//	state
	let personTimeline=persons[selectedPersonId].timeline??[]
	let eventDates=Object.fromEntries(personTimeline.map(entry=>[entry.event,entry.date]))
	document.getElementById(`state`).innerHTML=`
		<strong>Born </strong>${!eventDates[`birth`]||!yearsSince(eventDates[`birth`])?`???`:Math.floor(yearsSince(eventDates[`birth`]))} years ago.<br>
		${!eventDates[`death`]?`<br>`:`<strong>Died </strong>${yearsSince(eventDates[`death`])?Math.round(yearsSince(eventDates[`death`])):`???`} years ago. <subtle>${Math.floor(yearsSince(eventDates[`birth`])-yearsSince(eventDates[`death`]))} years old</subtle>`}`
	//	relations
	let personRelations=persons[selectedPersonId].relations??{}
	document.getElementById(`Relations`).innerHTML=relationDisplayOrder.map(
		relationType=>!personRelations?.[relationType]?.length?``:`
			<div id="${relationType}" class="relation-type">
				<div><strong>${capitaliseFirstLetter(relationType)}</strong></div>
				${personRelations[relationType].sort().map(renderRelationEntry).join(``)}
			</div>`
		).join(``)
	//	timeline
	document.getElementById(`Timeline`).innerHTML=!personTimeline.length?``:personTimeline.sort((a,b)=>[`year`,`month`,`day`].reduce((r,k)=>r||(a.date?.[k]??0)-(b.date?.[k]??0),0)).map(renderTimelineEntry).join(``)
}
function renderRelationEntry(id){
	let{name}=persons[id]
	let fullName=Object.values(name).map(nameType=>nameType.join(`-`)).join(` `)
	return`<div class="hover-move" onclick="selectPerson(${id})">${fullName}</div>`
}
function renderTimelineEntry(entry){
	let{date,event,location,notes}=entry
	return`
		<div>
			<details>
				<summary>${capitaliseFirstLetter(event)} ${date?.year?`(${date.year})`:``}</summary>
				${date?.year?`<div><strong>Date: </strong>${date.day&&date.month&&date.year?appendOrdinal(date.day):``} ${date.month&&date.year?monthNames[date.month-1]:``} ${date.year}</div>`:``}
				${location?`<div><strong>Location: </strong>${location}</div>`:``}
				${notes?`<div><strong>Notes: </strong>${notes}</div>`:``}
			</details>
		</div>`
}
function importData(){
	let fileInput=document.createElement(`input`)
	fileInput.type=`file`
	fileInput.accept=`.json`
	fileInput.style.display=`none`
	fileInput.onchange=(e)=>{
		let reader=new FileReader()
		reader.onload=()=>{
			selectedPersonId=0
			persons=JSON.parse(reader.result)
			renderPerson()
		}
		reader.readAsText(e.target.files[0])
		document.body.removeChild(fileInput)
	}
	fileInput.oncancel=()=>{
		document.body.removeChild(fileInput)
	}
	document.body.appendChild(fileInput)
	fileInput.click()
}
function exportData(){
	let date=new Date().toISOString().split('T')[0]
	let file=new Blob([JSON.stringify(persons)],{type:`application/json`})
	let link=document.createElement(`a`)
	link.href=URL.createObjectURL(file)
	link.download=`relation-index.json`
	link.click()
	URL.revokeObjectURL(link.href)
}
//	tools
function appendOrdinal(int){
	return int+((int%100>10&&int%100<14)
		?`th`
		:[`th`,`st`,`nd`,`rd`][int%10]||`th`)
}
function capitaliseFirstLetter(str){
	return String(str).charAt(0).toUpperCase()+String(str).slice(1)
}
function yearsSince(date){
	if(!date||date.year==null)return
	return(new Date-new Date(date.year,date?.month??1-1,date?.day??1))/31536e6
}
let monthNames=[
	`January`,
	`February`,
	`March`,
	`April`,
	`May`,
	`June`,
	`July`,
	`August`,
	`September`,
	`October`,
	`November`,
	`December`
]
//	initialisation
let selectedPersonId=0
createPerson()