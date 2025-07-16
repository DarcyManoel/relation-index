let persons=[]
function createPerson(){
	persons.push({
		name:{
			given:[`Person`],
			family:[persons.length+1]
		},
		relations:{
			parents:[],
			children:[]
		},
	})
	console.info(`Created new person of ID: ${persons.length-1}\n`,persons[persons.length-1])
	selectPerson(persons.length-1)
}
function showModal(triggerElement){
	document.getElementById(`modal`).classList.remove(`hidden`)
}
function closeModal(){
	document.getElementById(`modal`).classList.add(`hidden`)
	document.getElementById(`frame`).querySelector(`#title`).innerHTML=``
	document.getElementById(`frame`).querySelector(`#content`).innerHTML=``
	document.getElementById(`frame`).querySelector(`#description`).innerHTML=``
	document.getElementById(`frame`).querySelector(`#actions`).querySelector(`#save`).removeAttribute(`onclick`)
	tempRelations=[]
	tempRelationsInitialised=0
}
function editName(){
	let fullName=Object.values(persons[selectedPersonId].name).map(nameType=>nameType.join(`-`)).join(` `)
	document.getElementById(`frame`).querySelector(`#title`).innerHTML=`
		<div><strong>Editing Name:</strong></div>`
	document.getElementById(`frame`).querySelector(`#content`).innerHTML=`
		<input id="changeName" type="text" placeholder="${fullName}">`
	document.getElementById(`frame`).querySelector(`#description`).innerHTML=`
		Use a space to separate given and family names.<br>
		Use dashes (-) to separate multiple names of the same type.<br>
		For example: John-Jo Adams-Huck means given names John and Jo, and family names Adams and Huck.<br>
		Multiple names per type are optional.`
	document.getElementById(`frame`).querySelector(`#actions`).querySelector(`#save`).setAttribute(`onclick`,`saveName(document.getElementById('changeName').value)`)
}
function saveName(input){
	if(!input)return
	let[given,family]=input.trim().split(` `)
	persons[selectedPersonId].name.given=given.split(`-`)
	persons[selectedPersonId].name.family=family.split(`-`)
	renderPerson()
	closeModal()
}
let tempRelationsInitialised=0
let tempRelations=[]
function editRelations(relationType){
	if(!tempRelationsInitialised){
		tempRelations=persons[selectedPersonId].relations[relationType]
		tempRelationsInitialised=1
	}
	document.getElementById(`frame`).querySelector(`#title`).innerHTML=`
		<div><strong>Editing Relations:</strong></div>`
	document.getElementById(`frame`).querySelector(`#content`).innerHTML=`
		<div style="display:flex;gap:.5rem;">
			<div id="current-relations">${tempRelations.map(relation=>`<div class="hover-move hover-red" onclick="removeRelation('${relationType}',${relation})">${Object.values(persons[relation].name).map(nameType=>nameType.join(`-`)).join(` `)}</div>`).join(``)}</div>
			<div id="prospective-relations">${persons.map(person=>person===persons[selectedPersonId]?``:`<div class="hover-move hover-green ${tempRelations.includes(persons.indexOf(person))?`hovered-move hovered-green hover-red" onclick="removeRelation('${relationType}',${persons.indexOf(person)})"`:`" onclick="addRelation('${relationType}',${persons.indexOf(person)})"`}">${Object.values(person.name).map(nameType=>nameType.join(`-`)).join(` `)}</div>`).join(``)}</div>
		</div>`
	document.getElementById(`frame`).querySelector(`#description`).innerHTML=`
		The left panel displays all current relations of this type.<br>
		The right panel allows you to search for and add other people from the database.<br>
		Type a name in the search bar to filter available people.<br>
		Click on an unselected person in the right panel to add them to the relation.<br>
		Click on a person in the left panel to remove them from the relation.`
	document.getElementById(`frame`).querySelector(`#actions`).querySelector(`#save`).setAttribute(`onclick`,`saveRelations('${relationType}')`)
}
function removeRelation(relationType,relationToRemove){
	tempRelations=tempRelations.filter(id=>id!==relationToRemove)
	editRelations(relationType)
}
function addRelation(relationType,relationToAdd){
	tempRelations.push(relationToAdd)
	editRelations(relationType)
}
function saveRelations(relationType){
	processRelations(relationType,persons[selectedPersonId].relations[relationType],tempRelations)
	persons[selectedPersonId].relations[relationType]=tempRelations
	closeModal()
	renderPerson()
	tempRelationsInitialised=0
}
function editTimeline(){
	console.log(`test`)
}
let relationLinks={
	children:`parents`,
	parents:`children`,
	siblings:`siblings`
}
let inferredRelations={
	parents:[
		// {
		// 	infer:`grandparents`,
		// 	via:`parents`
		// },
		{
			infer:`siblings`,
			via:`children`
		}
	],
	children:[
		// {
		// 	infer:`grandchildren`,
		// 	via:`children`
		// },
	]
}
let ancestralDisplayOrder=[
	//`grandparents`,
	`parents`,
	`siblings`,
]
let descendantDisplayOrder=[
	`children`,
	//`grandchildren`,
]
function processRelations(relationType,realRelations,tempRelations){
	let linkedRelationType=relationLinks[relationType]
	for(let personId of realRelations){
		if(!tempRelations.includes(personId)){
			persons[personId].relations[linkedRelationType]=persons[personId].relations[linkedRelationType].filter(id=>id!==selectedPersonId)
		}
	}
	for(let personId of tempRelations){
		if(!realRelations.includes(personId)){
			persons[personId].relations[linkedRelationType].push(selectedPersonId)
		}
	}
}
function processPersons(){
	let actionCounter=0
	//	relations
	for(let personId in persons){
		let personRelations=persons[+personId].relations
		for(let[relationType,relationIds]of Object.entries(personRelations??{})){
			for(let relationId of relationIds){ // iterates through relations of type
				let relationRelations=persons[relationId].relations
				if(!(relationRelations[relationLinks[relationType]]??[]).includes(+personId)){ // check for direct relation links
					(relationRelations[relationLinks[relationType]]??[]).push(+personId)
				}
				for(let inferralInstructions of inferredRelations[relationType]??[]){
					for(let inferral of relationRelations[inferralInstructions.via]??[]){
						personRelations[inferralInstructions.infer]??=[]
						if(inferral!==+personId&&!personRelations[inferralInstructions.infer].includes(inferral)){
							personRelations[inferralInstructions.infer].push(inferral)
							actionCounter++
						}
					}
				}
			}
		}
	}
	if(actionCounter>0){ // if actionCounter is above 0, meaning any action has been processed, run this function again to ensure processing coverage
		processPersons()
	}
	else{
		renderPerson()
		reportData()
	}
}
function selectPerson(id){
	tempRelationsInitialised=0
	if(id>persons.length-1||typeof id===`undefined`)return console.warn(`Rejected selection of ID: ${id}. No person of ID: ${id} exists.`) // check if provided ID exists within database before changing selection
	selectedPersonId=id
	console.info(`Allowed selection of ID: ${selectedPersonId}\n`,persons[selectedPersonId])
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
	document.getElementById(`Ancestral`).querySelector(`.content`).innerHTML=ancestralDisplayOrder.map(
		relationType=>!personRelations?.[relationType]?.length?``:`
			<div id="${relationType}">
				<div class="edit button ${editMode?``:`hidden`}" onclick="showModal();editRelations('${relationType}')"></div>
				<div><strong>${capitaliseFirstLetter(relationType)}</strong></div>
				${personRelations[relationType].sort().map(renderRelationEntry).join(``)}
			</div>`
		).join(``)
	document.getElementById(`Descendant`).querySelector(`.content`).innerHTML=descendantDisplayOrder.map(
		relationType=>!personRelations?.[relationType]?.length?``:`
			<div id="${relationType}">
				<div class="edit button ${editMode?``:`hidden`}" onclick="showModal();editRelations('${relationType}')"></div>
				<div><strong>${capitaliseFirstLetter(relationType)}</strong></div>
				${personRelations[relationType].sort().map(renderRelationEntry).join(``)}
			</div>`
		).join(``)
	//	timeline
	document.getElementById(`Timeline`).querySelector(`.content`).innerHTML=!personTimeline.length?``:personTimeline.sort((a,b)=>[`year`,`month`,`day`].reduce((r,k)=>r||(a.date?.[k]??0)-(b.date?.[k]??0),0)).map(renderTimelineEntry).join(``)
}
function renderRelationEntry(id){
	let{name}=persons[id]
	let fullName=Object.values(name).map(nameType=>nameType.join(`-`)).join(` `)
	return`<div class="hover-move" onclick="selectPerson(${id})">${fullName}</div>`
}
function renderTimelineEntry(entry){
	let{date,event,location}=entry
	return`
		<div>
			<details>
				<summary>${capitaliseFirstLetter(event)} (${date.year})</summary>
				<div><strong>Date: </strong>${appendOrdinal(date.day)} ${monthNames[date.month-1]} ${date.year}</div>
				${location?`<div><strong>Location: </strong>${location}</div>`:``}
			</details>
		</div>`
}
function reportData(){
	console.log(`Data report at ${formatMilliseconds(new Date-initTime)}\n`,persons)
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
			console.log(`Imported database:`)
			processPersons()
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
	link.download=`relation-index data (${date}).json`
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
function formatMilliseconds(milliseconds){
	let pad=number=>String(number).padStart(2,`0`)
	let totalSeconds=Math.floor(milliseconds/1000)
	let days=Math.floor(totalSeconds/86400)
	let hours=Math.floor((totalSeconds%86400)/3600)
	let minutes=Math.floor((totalSeconds%3600)/60)
	let seconds=totalSeconds%60
	return`${days?pad(days)+`d `:``}${days||hours?pad(hours)+`h `:days?`00h `:``}${minutes||hours||days?pad(minutes)+`m `:hours||days?`00m `:``}${pad(seconds)}s`
}
function yearsSince(date){
	if(!date||date.year==null||date.month==null||date.day==null)return
	return(new Date-new Date(date.year,date.month-1,date.day))/31536e6
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
let initTime=new Date
let selectedPersonId=0
let editMode=0
createPerson()