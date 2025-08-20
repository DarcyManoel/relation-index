let persons=[]
function renderPersons(){
	document.getElementById(`navigation`).innerHTML=`<span onclick="renderPersons()">persons</span>`
	document.getElementById(`content`).innerHTML=persons.map((person,index)=>{
		let personEvents=person.events
		let eventDates=Object.fromEntries(personEvents.map(entry=>[entry.type,entry.date]))
		console.log(person)
		return`
			<details id="p${index}">
				<summary>${person.name.given.join(`-`)} ${person.name.family.join(`-`)}</summary>
				<details id="state" class="subtle" open>
					<summary>State</summary>
					<strong>Born </strong>${!eventDates[`birth`]||!yearsSince(eventDates[`birth`])?`???`:Math.floor(yearsSince(eventDates[`birth`]))} years ago.<br>
					${!eventDates[`death`]?``:`<strong>Died </strong>${yearsSince(eventDates[`death`])?Math.round(yearsSince(eventDates[`death`])):`???`} years ago.<subtle> ${Math.floor(yearsSince(eventDates[`birth`])-yearsSince(eventDates[`death`]))} years old</subtle>`}
				</details>
				<details id="name">
					<summary>Name</summary>
					<details>
						<summary>Alias</summary>
						${person.name.alias.map(name=>`
						<div>${name}</div>
						`).join(``)}
					</details>
					<details>
						<summary>Given</summary>
						${person.name.given.map(name=>`
						<div>${name}</div>
						`).join(``)}
					</details>
					<details>
						<summary>Family</summary>
						${person.name.family.map(name=>`
						<div>${name}</div>
						`).join(``)}
					</details>
				</details>
				<details id="relations">
					<summary>Relations</summary>
					<details>
						<summary>Parents</summary>
						${person.relations.parents.map(relation=>`
						<div href="#p${relation}" onclick="document.getElementById(\`p${relation}\`).setAttribute(\`open\`,\`\`)">${persons[relation].name.given.join(`-`)} ${persons[relation].name.family.join(`-`)}</div>
						`).join(``)}
					</details>
					${Object.entries(person.relations).map(([relationType,relations])=>relationType===`parents`?``:`
					<details>
						<summary>${capitaliseFirstLetter(relationType)}</summary>
						${relations.map(relation=>`
						<div href="#p${relation}" onclick="document.getElementById(\`p${relation}\`).setAttribute(\`open\`,\`\`)">${persons[relation].name.given.join(`-`)} ${persons[relation].name.family.join(`-`)}</div>
						`).join(``)}
					</details>
					`).join(``)}
				</details>
				<details id="events">
					<summary>Events</summary>
					${person.events.map(event=>`
					<details>
						<summary>${capitaliseFirstLetter(event.type)}</summary>
						${Object.entries(event).map(([key,value])=>key===`date`?`
						<details>
							<summary>${key}</summary>
							${Object.entries(value).map(([key,value])=>key===`month`?`
							<div><strong>${key}: </strong>${value} <subtle>(${monthNames[value-1]})</subtle></div>
							`:`
							<div><strong>${key}: </strong>${value}</div>
							`).join(``)}
						</details>
						`:`
						<div><strong>${key}: </strong>${value}</div>
						`).join(``)}
					</details>
					`).join(``)}
				</details>
			</details>
	`}).join(``)
}
function importData(){
	let fileInput=document.createElement(`input`)
	fileInput.type=`file`
	fileInput.accept=`.json`
	fileInput.style.display=`none`
	fileInput.onchange=(e)=>{
		let reader=new FileReader()
		reader.onload=()=>{
			console.log(persons=JSON.parse(reader.result))
			renderPersons()
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
renderPersons()
//	tools
function appendOrdinal(int){
	return int+((int%100>10&&int%100<14)
		?`th`
		:[`th`,`st`,`nd`,`rd`][int%10]||`th`)
}
function capitaliseFirstLetter(str){
	return String(str).charAt(0).toUpperCase()+String(str).slice(1)
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
function yearsSince(date){
	if(!date||date.year==null)return
	return(new Date-new Date(date.year,date?.month??1-1,date?.day??1))/31536e6
}