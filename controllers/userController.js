const users = require("../data/users");

const getUsers = (req, res) => {
    res.json(users);
};

const addUser = (req, res) => {
    const newUser = {

        id: users.length + 1,
        name: req.body.name,
        email: req.body.email,
        age: req.body.age
    };

    users.push(newUser);

    res.json({

        message: "User Added Successfully",
        user: newUser
    });
};

module.exports = {
    getUsers,
    addUser
};