const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/userRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/", userRoutes);



// //Home API
// app.get("/",(req, res) => {
//   res.json({
//     message:"Server Running Successfully"
//   });
// });


//About API
// app.get("/about",(req,res) => {
//     res.json({
//     name:"Intern Project",
//     technology: "NodeJs"
//   });
// });

// app.get("/student", (req, res) => {
//     res.json({
//         name: "Rahul",
//         age: 22
//     });
// });

// app.put("/student/:id", (req, res) => {
//     const id = req.params.id;
//     res.json({
//         message: "Student Updated Successfully",
//         studentId: id,
//         updatedData: req.body
//     });
// });

// app.delete("/student/:id", (req, res) => {
//     const id = req.params.id;
//     res.json({
//         message: "Student Deleted Successfully",
//         studentId: id
//     });
// });

//Student API
// app.post("/student",(req,res) => {
//     res.json({
//         message: "Student Added Successfully"
//     });
// });

app.listen(5000, () => {
    console.log("Server runnung on http://localhost:5000");
});
