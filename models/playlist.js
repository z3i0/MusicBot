module.exports = (sequelize, DataTypes) => {
    const Playlist = sequelize.define(
        "Playlist",
        {
            userId: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
        },
        {
            tableName: "playlists",
            timestamps: true,
            indexes: [
                {
                    unique: true,
                    fields: ["userId", "name"],
                },
            ],
        }
    );

    Playlist.associate = (models) => {
        Playlist.hasMany(models.PlaylistItem, {
            as: "items",
            foreignKey: "playlistId",
            onDelete: "CASCADE",
        });
    };

    return Playlist;
};
