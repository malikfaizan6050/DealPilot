List<Opportunity> opportunities = [
    SELECT Id, Name, AccountId
    FROM Opportunity
    WHERE IsClosed = false
    ORDER BY CreatedDate ASC, Id ASC
    LIMIT 14
];

System.assertEquals(
    14,
    opportunities.size(),
    'DealPilot demo setup requires exactly 14 open Opportunities.'
);

List<String> accountNames = new List<String>{
    'Cloud Kicks',
    'Northern Trail Outfitters',
    'Edge Communications',
    'Grand Hotels & Resorts Ltd',
    'Burlington Textiles Corp of America',
    'Express Logistics and Transport',
    'DreamHouse Realty',
    'University of Arizona',
    'GenePoint',
    'United Oil & Gas Corp.',
    'Ursa Major Solar',
    'Pyramid Construction Inc.',
    'Get Cloudy Consulting',
    'Dickenson plc'
};

List<String> opportunityNames = new List<String>{
    'Cloud Kicks - Commerce Cloud Expansion',
    'Northern Trail Outfitters - Data Cloud Customer 360',
    'Edge Communications - Service Cloud Transformation',
    'Grand Hotels & Resorts - Marketing Cloud Renewal',
    'Burlington Textiles - Revenue Cloud CPQ',
    'Express Logistics - Tableau Revenue Analytics',
    'DreamHouse Realty - Experience Cloud Broker Portal',
    'University of Arizona - Education Cloud Student Success',
    'GenePoint - Life Sciences Cloud Expansion',
    'United Oil & Gas - Enterprise Analytics Modernization',
    'Ursa Major Solar - Field Service Scale-Up',
    'Pyramid Construction - Field Service Automation',
    'Get Cloudy Consulting - Partner Experience Portal',
    'Dickenson plc - Sales Cloud Modernization'
};

List<Decimal> amounts = new List<Decimal>{
    480000,
    360000,
    225000,
    195000,
    175000,
    145000,
    130000,
    115000,
    295000,
    265000,
    210000,
    155000,
    98000,
    85000
};

List<String> stages = new List<String>{
    'Proposal/Price Quote',
    'Value Proposition',
    'Negotiation/Review',
    'Qualification',
    'Value Proposition',
    'Needs Analysis',
    'Proposal/Price Quote',
    'Qualification',
    'Negotiation/Review',
    'Proposal/Price Quote',
    'Value Proposition',
    'Needs Analysis',
    'Negotiation/Review',
    'Qualification'
};

List<Integer> closeDateOffsets = new List<Integer>{
    -25,
    -10,
    5,
    -40,
    12,
    24,
    35,
    45,
    28,
    42,
    55,
    70,
    21,
    90
};

List<String> nextSteps = new List<String>{
    null,
    null,
    null,
    null,
    'Confirm procurement committee availability and agree the commercial review date.',
    'Validate executive dashboard requirements with the finance and operations teams.',
    null,
    'Complete the security questionnaire and schedule the architecture review.',
    'Finalize the data processing agreement and route the order form for signature.',
    'Review the final proposal with the economic buyer and confirm contracting milestones.',
    'Run the executive value workshop and agree the phased rollout plan.',
    'Complete field-service workflow mapping and confirm integration owners.',
    'Confirm launch governance, partner onboarding milestones, and the production date.',
    'Schedule solution design with sales operations and document success criteria.'
};

List<Integer> activityDateOffsets = new List<Integer>{
    null,
    -75,
    null,
    -60,
    -38,
    null,
    -28,
    -40,
    -2,
    -5,
    -3,
    -7,
    -1,
    -10
};

List<String> activitySubjects = new List<String>{
    null,
    'Discovery follow-up with digital leadership',
    null,
    'Renewal planning call with marketing operations',
    'Procurement readiness review',
    null,
    'Broker portal proposal review',
    'Security and compliance discovery',
    'Contract and data-processing review',
    'Executive proposal walkthrough',
    'Field Service value workshop',
    'Workflow mapping session',
    'Partner launch readiness call',
    'Sales operations discovery session'
};

Set<String> accountNameSet = new Set<String>();
accountNameSet.addAll(accountNames);

Map<String, Account> accountsByName = new Map<String, Account>();

for (Account accountRecord : [
    SELECT Id, Name
    FROM Account
    WHERE Name IN :accountNameSet
]) {
    accountsByName.put(accountRecord.Name, accountRecord);
}

List<Account> accountsToInsert = new List<Account>();

for (String accountName : accountNames) {
    if (!accountsByName.containsKey(accountName)) {
        accountsToInsert.add(new Account(Name = accountName));
    }
}

if (!accountsToInsert.isEmpty()) {
    insert accountsToInsert;

    for (Account accountRecord : accountsToInsert) {
        accountsByName.put(accountRecord.Name, accountRecord);
    }
}

Set<Id> opportunityIds = new Set<Id>();

for (Opportunity opportunity : opportunities) {
    opportunityIds.add(opportunity.Id);
}

List<Task> existingTasks = [
    SELECT Id
    FROM Task
    WHERE WhatId IN :opportunityIds
];

if (!existingTasks.isEmpty()) {
    delete existingTasks;
}

List<Event> existingEvents = [
    SELECT Id
    FROM Event
    WHERE WhatId IN :opportunityIds
];

if (!existingEvents.isEmpty()) {
    delete existingEvents;
}

for (Integer index = 0; index < opportunities.size(); index++) {
    Opportunity opportunity = opportunities[index];

    opportunity.AccountId = accountsByName.get(accountNames[index]).Id;
    opportunity.Name = opportunityNames[index];
    opportunity.Amount = amounts[index];
    opportunity.StageName = stages[index];
    opportunity.CloseDate = Date.today().addDays(closeDateOffsets[index]);
    opportunity.NextStep = nextSteps[index];
    opportunity.Health_Score__c = null;
    opportunity.Risk_Summary__c = null;
    opportunity.Last_Scanned__c = null;
}

update opportunities;

List<Task> demoTasks = new List<Task>();

for (Integer index = 0; index < opportunities.size(); index++) {
    Integer activityOffset = activityDateOffsets[index];

    if (activityOffset == null) {
        continue;
    }

    demoTasks.add(
        new Task(
            WhatId = opportunities[index].Id,
            Subject = activitySubjects[index],
            ActivityDate = Date.today().addDays(activityOffset),
            Status = 'Completed',
            Priority = 'Normal'
        )
    );
}

if (!demoTasks.isEmpty()) {
    insert demoTasks;
}

System.debug(
    LoggingLevel.ERROR,
    'DEALPILOT DEMO COMPLETE: Updated 14 Opportunities, assigned Salesforce-style Accounts, reset AI fields, and created ' +
    demoTasks.size() +
    ' completed activities.'
);
