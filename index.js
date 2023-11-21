const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);


const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// user defined middleware
const verifyToken = (req, res, next) => {
  // console.log(req.headers.authorization)
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "forbidden access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};



const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6nmlwzx.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const menuCollections = client.db("bostroBossDB").collection("menuItems");
    const cartsCollections = client.db("bostroBossDB").collection("cartItems");
    const usersCollections = client.db("bostroBossDB").collection("users");
    const paymentsCollections = client.db("bostroBossDB").collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded?.email
      const query = {email: email};
      const user = await usersCollections.findOne(query);
      const isAdmin = user?.role === 'admin';
      if(!isAdmin) {
        return res.status(403).send({message: 'forbidden access'})
      }
      next();
    }

    // jwt related api
    app.post("/api/v1/jwt", (req, res) => {
      const email = req.body.email;
      // console.log(email)
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ token });
    });

    // menu related api
    app.get("/api/v1/allMenu", async (req, res) => {
      const result = await menuCollections.find().toArray();
      res.send(result);
    });
    // single menu
    app.get("/api/v1/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await menuCollections.findOne(query);
      res.send(result);
    })

    //////// carts collection
    app.post("/api/v1/allCarts", verifyToken, async (req, res) => {
      const cartInfo = req.body;
      const result = await cartsCollections.insertOne(cartInfo);
      res.send(result);
    });

    app.get("/api/v1/allCarts",   async (req, res) => {
      const email = req.query.email;
      // console.log(email);
      const query = { email: email };
      const result = await cartsCollections.find(query).toArray();
      res.send(result);
    });
    app.delete("/api/v1/allCarts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollections.deleteOne(query);
      res.send(result);
    });

    // payments related api
    app.post('/api/v1/create-payment-intent', async (req, res) => {
      const {price} = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: parseInt(price * 100),
        currency: 'usd',
        payment_method_types: ['card'],
      })
      res.send({
        clientSecret: paymentIntent.client_secret,
      })
    })


    app.get('/api/v1/getPayments/:email', verifyToken, async (req, res) =>{
      const query = {email: req.params.email};
      console.log('email from params',req.params.email);
      if(req.params.email !== req.decoded.email) {
        return res.status(403).send({message: 'forbidden access'});
      }
      const result = await paymentsCollections.find(query).toArray();
      res.send(result);
    })

    app.post('/api/v1/payment', async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentsCollections.insertOne(payment);

      // carefully delete each cart from database

      console.log('payment info', payment);
      const query = {_id: {
        $in: payment.cartIds.map(id => new ObjectId(id))
      }}

      const deleteResult = await cartsCollections.deleteMany(query);
      res.send({paymentResult, deleteResult});
    })

    ////////// user related api
    app.post("/api/v1/users", async (req, res) => {
      const user = req.body;
      const quey = { email: user?.email };
      const existUser = await usersCollections.findOne(quey);
      if (existUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await usersCollections.insertOne(user);
      res.send(result);
    });

    //////////////// admin related api
    app.get("/api/v1/allUsers", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollections.find().toArray();
      res.send(result);
    });

    app.delete("/api/v1/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollections.deleteOne(query);
      res.send(result);
    });

    app.patch("/api/v1/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollections.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.get("/api/v1/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email
      if (!email === req.decoded?.email) {
        return res.status(403).send({ message: "unauthorized access" });
      }

      const query = { email: email };
      const user = await usersCollections.findOne(query);
     
      let admin = false;
      if (user?.role === "admin") {
        admin = user.role;
      }
      res.send({ admin });
    });

    // add items
    app.post('/api/v1/menuItem', verifyToken, verifyAdmin, async (req, res) => {
      const menuData = req.body;
      const result = await menuCollections.insertOne(menuData)
      res.send(result);
    })
    // delete items
    app.delete('/api/v1/menuItem/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await menuCollections.deleteOne(query);
      res.send(result);
    })
    // update an items
    app.patch('/api/v1/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const item = req.body;
      const filter = {_id: new ObjectId(id)};
      const options = {upsert: true};
      const updatedDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
        }
      }
      const result = await menuCollections.updateOne(filter, updatedDoc, options);
      res.send(result);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("BISTRO BOSS RESTAURANT SERVER IS ONLINE");
});

app.listen(port, () => {
  console.log(`listening on ${port}`);
});
