let persons=[]
let personTemplate={
	name:{
		alias:[],
		family:[],
		given:[]
	},
	relations:{
		parents:[],
		children:[]
	},
	events:[
	]
}
function createPerson(){
	persons.push(JSON.parse(JSON.stringify(personTemplate)))
	console.log(persons.at(-1))
	renderPersons()
}
function renderPersons(){
	document.getElementById(`persons`).innerHTML=persons.map((person,id)=>`
		<details id="p${id}">
			<summary>
				<div class="name">${person.name.given.join(`-`)||`Person`} ${person.name.family.join(`-`)||id}${person.name.alias.map(alias=>`<div class="alias" hidden="until-found">'${alias}'</div>`).join(``)}
				</div>
			</summary>
			<details>
				<summary locked>Relations</summary>
				${Object.entries(person.relations).map(([relationType,relationsOfType])=>!relationsOfType.length?``:`
					<details>
						<summary>${capitaliseFirstLetter(relationType)}</summary>
						${relationsOfType.map(relation=>`
							<div href="#p${relation}" onclick="document.getElementById(\`p${relation}\`).setAttribute(\`open\`,\`\`)">${persons[relation].name.given.join(`-`)||`Person`} ${person.name.family.join(`-`)||relation}</div>
						`).join(``)}
					</details>
				`).join(``)}
			</details>
			<details>
				<summary locked>Events</summary>
				${person.events
					.sort((a,b)=>
						a.date.year-b.date.year||
						a.date.month-b.date.month||
						a.date.day-b.date.day)
					.map(event=>`
						<details>
							<summary>${capitaliseFirstLetter(event.type)} (${event.date.year})</summary>
							${Object.entries(event).map(([key,value])=>`
								<strong>${key}: </strong>${key===`date`
									?`${appendOrdinal(value.day)} ${monthNames[value.month-1]} ${value.year}`
									:value}
							`).join(`<br>`)}
						</details>`).join(``)}
			</details>
		</details>`).join(``)
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
	link.download=`profiles.json`
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