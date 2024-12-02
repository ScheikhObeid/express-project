// templates.js

const generateAwayRequest = (partnerCode, travelClass, departure, formattedDate, arrival) => ({
    partner_code: partnerCode,
    agent_code: "9876",
    language: "DE",
    currency: "EUR",
    travel_class: travelClass,
    day_trains_only: false,
    night_trains_only: false,
    departure: {
        ibnr: departure,
        date_time: `${formattedDate}T00:00:00`
    },
    arrival: {
        ibnr: arrival
    },
    passengers: [
        {
            id: 1,
            gender: "M",
            first_name: "John",
            last_name: "Doe",
            date_of_birth: "1995-01-25",
            reduction: "Keine Ermässigung"
        },
        {
            id: 2,
            gender: "M",
            first_name: "John",
            last_name: "Doe2",
            date_of_birth: "1993-01-25",
            reduction: "Keine Ermässigung"
        },
        {
            id: 3,
            gender: "M",
            first_name: "Kind",
            last_name: "Doe3",
            date_of_birth: "2016-01-25"
        },
        {
            id: 4,
            gender: "M",
            first_name: "Kind",
            last_name: "Doe4",
            date_of_birth: "2014-01-25"
        }
    ]
});

const generateReturnRequest = (partnerCode, travelClass, arrival, formattedDate, departure) => ({
    partner_code: partnerCode,
    agent_code: "9876",
    language: "DE",
    currency: "EUR",
    travel_class: travelClass,
    day_trains_only: false,
    night_trains_only: false,
    departure: {
        ibnr: arrival,
        date_time: `${formattedDate}T00:00:00`
    },
    arrival: {
        ibnr: departure
    },
    passengers: [
        {
            id: 1,
            gender: "M",
            first_name: "John",
            last_name: "Doe",
            date_of_birth: "1995-01-25",
            reduction: "Keine Ermässigung"
        },
        {
            id: 2,
            gender: "M",
            first_name: "John",
            last_name: "Doe2",
            date_of_birth: "1993-01-25",
            reduction: "Keine Ermässigung"
        },
        {
            id: 3,
            gender: "M",
            first_name: "Kind",
            last_name: "Doe3",
            date_of_birth: "2016-01-25"
        },
        {
            id: 4,
            gender: "M",
            first_name: "Kind",
            last_name: "Doe4",
            date_of_birth: "2014-01-25"
        }
    ]
});

module.exports = { generateAwayRequest, generateReturnRequest };
